import sys
import os
import time
from pathlib import Path
from dotenv import load_dotenv

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

from recorder import WindowRecorder

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
VIDEOS_DIR = BASE_DIR / "videos" / "selenium"
SCREENSHOTS_DIR = BASE_DIR / "screenshots"
LOGS_DIR = BASE_DIR / "logs"

VIDEOS_DIR.mkdir(parents=True, exist_ok=True)
SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)
LOGS_DIR.mkdir(parents=True, exist_ok=True)


def sesion_muerta(url: str) -> bool:
    return BAD_URL_TOKEN in (url or "")


def crear_driver():
    headless = os.getenv("HEADLESS", "false").lower() == "true"
    width = os.getenv("WINDOW_WIDTH", "1366")
    height = os.getenv("WINDOW_HEIGHT", "900")

    options = Options()

    if headless:
        options.add_argument("--headless=new")
        options.add_argument("--disable-gpu")
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-dev-shm-usage")

    options.add_argument(f"--window-size={width},{height}")
    options.set_capability("goog:loggingPrefs", {"browser": "ALL"})

    driver = webdriver.Chrome(options=options)

    if not headless:
        driver.set_window_rect(x=50, y=50, width=int(width), height=int(height))

    return driver

def validar_sesion(driver) -> None:
    current_url = driver.current_url
    print("URL actual:", current_url)

    if sesion_muerta(current_url):
        raise Exception("Sesión inválida detectada. Cayó en josso_security_check.")

def esperar_pantalla_lista_real(driver, console_logs: list[str], timeout: int = 45) -> None:
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
            fallos = []

            try:
                validar_sesion(driver)

                if "cotizador" not in driver.current_url:
                    fallos.append("url")

                try:
                    body = driver.find_element(By.TAG_NAME, "body").text.strip().lower()
                except Exception:
                    body = ""
                    fallos.append("body")

                if "cargando, por favor espere" in body:
                    fallos.append("overlay")

                if "cargando componentes visuales" in body:
                    fallos.append("componentes")

                try:
                    logo = driver.find_element(By.ID, "header-logo")
                    if not logo.is_displayed():
                        fallos.append("logo")
                except Exception:
                    fallos.append("logo")

                try:
                    cotit = driver.find_element(By.CSS_SELECTOR, 'img[name="Cotit"]')
                    if cotit.is_displayed():
                        fallos.append("cotit")
                except Exception:
                    pass

                if TEXTO_RAZON_SOCIAL in body:
                    fallos.append("razon_social")

                try:
                    campo = driver.find_element(By.ID, "customerType")
                    valor = campo.get_attribute("value")

                    if not campo.is_displayed():
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

            time.sleep(0.7)

        if recargas < MAX_RECARGAS:
            recargas += 1
            print(
                f"Pantalla inválida tras {VALIDACIONES_POR_CICLO} validaciones {ultimo_fallos}. "
                f"Refresh {recargas}/{MAX_RECARGAS}"
            )
            driver.refresh()
            time.sleep(2)
            continue

        raise Exception(f"Pantalla incorrecta tras varios refresh: {ultimo_fallos}")

    raise Exception("Timeout esperando pantalla correcta.")
def ejecutar_flujo():
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    video_file = VIDEOS_DIR / f"selenium_{timestamp}.mp4"
    screenshot_file = SCREENSHOTS_DIR / f"selenium_popup_{timestamp}.png"
    error_screenshot_file = SCREENSHOTS_DIR / f"selenium_error_{timestamp}.png"
    console_file = LOGS_DIR / f"selenium_console_{timestamp}.txt"

    console_logs: list[str] = []

    driver = crear_driver()
    wait = WebDriverWait(driver, 20)

    def get_browser_region():
        rect = driver.get_window_rect()
        return {
            "left": rect["x"],
            "top": rect["y"],
            "width": rect["width"],
            "height": rect["height"],
        }

    rec = WindowRecorder(
        filename=str(video_file),
        fps=12,
        region_getter=get_browser_region,
        output_size=(1366, 900),
    )

    start = time.perf_counter()

    try:
        print("Iniciando grabación...")
        print(f"Video: {video_file}")
        rec.start()

        print("Abriendo login...")
        driver.get(LOGIN_URL)
        validar_sesion(driver)

        print("Ingresando usuario...")
        wait.until(
            EC.visibility_of_element_located((By.NAME, "userName"))
        ).send_keys(USUARIO)

        print("Esperando overlay...")
        wait.until(
            EC.invisibility_of_element_located((By.ID, "contenedor_carga"))
        )

        print("Click primer ingresar...")
        try:
            wait.until(
                EC.element_to_be_clickable((By.ID, "btnEntrar"))
            ).click()
        except Exception:
            boton = wait.until(EC.presence_of_element_located((By.ID, "btnEntrar")))
            driver.execute_script("arguments[0].click();", boton)

        validar_sesion(driver)

        print("Ingresando password...")
        wait.until(
            EC.visibility_of_element_located((By.NAME, "userPassword"))
        ).send_keys(PASSWORD)

        print("Esperando overlay otra vez...")
        wait.until(
            EC.invisibility_of_element_located((By.ID, "contenedor_carga"))
        )

        print("Click segundo ingresar...")
        try:
            wait.until(
                EC.element_to_be_clickable((By.ID, "btnEntrar"))
            ).click()
        except Exception:
            boton = wait.until(EC.presence_of_element_located((By.ID, "btnEntrar")))
            driver.execute_script("arguments[0].click();", boton)

        print("Esperando popup...")
        WebDriverWait(driver, 15).until(lambda d: len(d.window_handles) > 1)
        driver.switch_to.window(driver.window_handles[-1])
        driver.set_window_rect(x=50, y=50, width=1366, height=900)

        WebDriverWait(driver, 15).until(lambda d: d.current_url not in ["", "about:blank"])

        print("Esperando carga completa...")
        wait.until(lambda d: d.execute_script("return document.readyState") == "complete")

        # Refresh opcional si el popup quedó medio atorado
        try:
            body_text = driver.find_element(By.TAG_NAME, "body").text.lower()
            if (
                "cargando componentes visuales" in body_text
                or "cargando, por favor espere" in body_text
            ):
                print("Popup atorado, refresh...")
                driver.refresh()
                wait.until(lambda d: d.execute_script("return document.readyState") == "complete")
        except Exception:
            pass

        esperar_pantalla_lista_real(driver, console_logs, timeout=40)
        validar_sesion(driver)

        if "cotizador" not in driver.current_url:
            raise Exception(f"No llegó al cotizador. URL actual: {driver.current_url}")

        driver.save_screenshot(str(screenshot_file))

        with open(console_file, "w", encoding="utf-8") as f:
            f.write("\n".join(console_logs))

        elapsed = round(time.perf_counter() - start, 2)
        print(f"OK | Tiempo total: {elapsed}s")
        print(f"Screenshot: {screenshot_file}")
        print(f"Console log: {console_file}")

        return True

    except Exception as e:
        elapsed = round(time.perf_counter() - start, 2)
        print(f"ERROR: {e}")
        print(f"Tiempo antes del fallo: {elapsed}s")

        try:
            driver.save_screenshot(str(error_screenshot_file))
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
        try:
            rec.stop()
            print(f"Grabación guardada en: {video_file}")
        except Exception as e:
            print(f"No se pudo cerrar la grabación: {e}")

        driver.quit()


def main():
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