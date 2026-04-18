import sys
import os
import time
from pathlib import Path
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

load_dotenv()

USUARIO = os.getenv("USUARIO")
PASSWORD = os.getenv("PASSWORD")

if not USUARIO or not PASSWORD:
    print("ERROR: Faltan USUARIO o PASSWORD en el archivo .env")
    sys.exit(1)

TIPO_PERSONA_SELECTOR = "#customerType"
TIPO_PERSONA_READY_VALUE = "1"
BAD_URL_TOKEN = "josso_security_check"
LOGIN_URL = "https://cck.creditoclick.com.mx/users-web/auth/kia/login?w=true"
MAX_REINTENTOS = 3

BASE_DIR = Path(__file__).resolve().parent
VIDEOS_DIR = BASE_DIR / "videos" / "playwright"
SCREENSHOTS_DIR = BASE_DIR / "screenshots"
LOGS_DIR = BASE_DIR / "logs"

VIDEOS_DIR.mkdir(parents=True, exist_ok=True)
SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)
LOGS_DIR.mkdir(parents=True, exist_ok=True)


def sesion_muerta(url: str) -> bool:
    return BAD_URL_TOKEN in (url or "")


def validar_sesion(page_or_popup) -> None:
    current_url = page_or_popup.url
    print("URL actual:", current_url)

    if sesion_muerta(current_url):
        raise Exception("Sesión inválida detectada. Cayó en josso_security_check.")


def esperar_pantalla_lista_real(popup, console_logs: list[str], timeout: int = 45) -> None:
    inicio = time.time()
    recargas = 0
    MAX_RECARGAS = 3
    VALIDACIONES_POR_CICLO = 3

    TEXTO_RAZON_SOCIAL = (
        "capturar nombre de razón social como aparece en el registro del rfc ó documentos oficiales"
    )

    while time.time() - inicio < timeout:
        ultimo_fallos = []

        for intento_validacion in range(1, VALIDACIONES_POR_CICLO + 1):
            popup.wait_for_timeout(700)
            fallos = []

            try:
                validar_sesion(popup)

                if "cotizador" not in popup.url:
                    fallos.append("url")

                try:
                    body = popup.locator("body").inner_text(timeout=2000).lower()
                except Exception:
                    body = ""
                    fallos.append("body")

                if "cargando, por favor espere" in body:
                    fallos.append("overlay")

                if "cargando componentes visuales" in body:
                    fallos.append("componentes")

                try:
                    logo = popup.locator("#header-logo").first
                    if logo.count() == 0 or not logo.is_visible():
                        fallos.append("logo")
                except Exception:
                    fallos.append("logo")

                try:
                    cotit = popup.locator('img[name="Cotit"]').first
                    if cotit.count() > 0 and cotit.is_visible():
                        fallos.append("cotit")
                except Exception:
                    pass

                if TEXTO_RAZON_SOCIAL in body:
                    fallos.append("razon_social")

                try:
                    campo = popup.locator("#customerType").first
                    valor = campo.input_value()

                    if not campo.is_visible():
                        fallos.append("customer_hidden")

                    if not campo.is_enabled():
                        fallos.append("customer_disabled")

                    if valor != "1":
                        fallos.append(f"customer_value={valor}")

                except Exception:
                    fallos.append("customerType")

                if not fallos:
                    return

                ultimo_fallos = fallos
                print(
                    f"Validación {intento_validacion}/{VALIDACIONES_POR_CICLO} falló: {fallos}"
                )

            except Exception as e:
                ultimo_fallos = [f"exception={e}"]
                print(
                    f"Validación {intento_validacion}/{VALIDACIONES_POR_CICLO} lanzó error: {e}"
                )

        if recargas < MAX_RECARGAS:
            recargas += 1
            print(
                f"Pantalla inválida tras {VALIDACIONES_POR_CICLO} validaciones {ultimo_fallos}. "
                f"Reload {recargas}/{MAX_RECARGAS}"
            )
            popup.reload(wait_until="domcontentloaded", timeout=30000)
            continue

        raise Exception(f"Pantalla incorrecta tras varios reloads: {ultimo_fallos}")

    raise Exception("Timeout esperando pantalla correcta.")

def ejecutar_flujo() -> None:
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    screenshot_file = SCREENSHOTS_DIR / f"playwright_popup_{timestamp}.png"
    error_screenshot_file = SCREENSHOTS_DIR / f"playwright_error_{timestamp}.png"
    console_file = LOGS_DIR / f"playwright_console_{timestamp}.txt"

    console_logs: list[str] = []

    def on_console(msg) -> None:
        texto = msg.text
        console_logs.append(texto)
        print("CONSOLE:", texto)

    with sync_playwright() as p:
        HEADLESS = os.getenv("HEADLESS", "false").lower() == "true"
        browser = p.chromium.launch(headless=HEADLESS)
        context = browser.new_context(
            record_video_dir=str(VIDEOS_DIR),
            viewport={"width": 1366, "height": 900},
        )

        page = context.new_page()
        page.on("console", on_console)

        popup = None
        start = time.perf_counter()

        try:
            print(f"Carpeta de videos: {VIDEOS_DIR}")
            print("Abriendo login...")
            page.goto(LOGIN_URL, timeout=30000)
            validar_sesion(page)

            print("Ingresando usuario...")
            page.fill('input[name="userName"]', USUARIO)

            print("Click primer ingresar...")
            page.locator("#btnEntrar").click()
            validar_sesion(page)

            print("Ingresando password...")
            page.fill('input[name="userPassword"]', PASSWORD)

            print("Click segundo ingresar y esperando popup...")
            with page.expect_popup(timeout=15000) as popup_info:
                page.locator("#btnEntrar").click()

            popup = popup_info.value
            popup.on("console", on_console)

            popup.wait_for_load_state("domcontentloaded", timeout=30000)

            esperar_pantalla_lista_real(popup, console_logs, timeout=40)
            validar_sesion(popup)

            if "cotizador" not in popup.url:
                raise Exception(f"No llegó al cotizador. URL actual: {popup.url}")

            popup.screenshot(path=str(screenshot_file))

            with open(console_file, "w", encoding="utf-8") as f:
                f.write("\n".join(console_logs))

            elapsed = round(time.perf_counter() - start, 2)
            print(f"OK | Tiempo total: {elapsed}s")
            print(f"Screenshot: {screenshot_file}")
            print(f"Console log: {console_file}")

        except Exception as e:
            elapsed = round(time.perf_counter() - start, 2)
            print(f"ERROR: {e}")
            print(f"Tiempo antes del fallo: {elapsed}s")

            try:
                target = popup if popup else page
                target.screenshot(path=str(error_screenshot_file))
                print(f"Screenshot error: {error_screenshot_file}")
            except Exception:
                pass

            try:
                with open(console_file, "w", encoding="utf-8") as f:
                    f.write("\n".join(console_logs))
                print(f"Console log: {console_file}")
            except Exception:
                pass

            raise

        finally:
            page_video = page.video.path() if page.video else None
            popup_video = popup.video.path() if popup and popup.video else None

            if popup:
                try:
                    popup.close()
                except Exception:
                    pass

            try:
                page.close()
            except Exception:
                pass

            context.close()
            browser.close()

            print(f"Video page: {page_video}")
            print(f"Video popup: {popup_video}")


def main() -> None:
    for intento in range(1, MAX_REINTENTOS + 1):
        try:
            print(f"\nIntento {intento}/{MAX_REINTENTOS}")
            ejecutar_flujo()
            sys.exit(0)

        except Exception as e:
            print(f"ERROR en intento {intento}: {e}")

            if intento == MAX_REINTENTOS:
                sys.exit(1)

            print("Reintentando con nueva sesión...")


if __name__ == "__main__":
    main()