import subprocess
import time
import csv
from pathlib import Path
from datetime import datetime

BASE_DIR = Path(__file__).resolve().parent

TESTS = [
    {
        "name": "playwright",
        "workdir": BASE_DIR / "RPA-PLAY",
        "python": BASE_DIR / "RPA-PLAY" / "penv" / "Scripts" / "python.exe",
        "script": "main.py",
    },
    {
        "name": "selenium",
        "workdir": BASE_DIR / "RPA-SELENIUM",
        "python": BASE_DIR / "RPA-SELENIUM" / "senv" / "Scripts" / "python.exe",
        "script": "main.py",
    },
]

RUNS_PER_TOOL = 500
TIMEOUT_SECONDS = 120

RESULTS_FILE = BASE_DIR / "benchmark_results.csv"


def run_test(test: dict, run_number: int) -> dict:
    command = [str(test["python"]), test["script"]]

    start = time.perf_counter()
    started_at = datetime.now().isoformat(timespec="seconds")

    try:
        process = subprocess.run(
            command,
            cwd=test["workdir"],
            capture_output=True,
            text=True,
            timeout=TIMEOUT_SECONDS,
        )
        end = time.perf_counter()
        duration = round(end - start, 2)

        success = process.returncode == 0

        return {
            "tool": test["name"],
            "run": run_number,
            "started_at": started_at,
            "duration_seconds": duration,
            "success": success,
            "return_code": process.returncode,
            "stdout": process.stdout.strip(),
            "stderr": process.stderr.strip(),
        }

    except subprocess.TimeoutExpired as e:
        end = time.perf_counter()
        duration = round(end - start, 2)

        stdout = ""
        stderr = "Tiempo excedido"

        if e.stdout:
            stdout = e.stdout.decode("utf-8", errors="replace") if isinstance(e.stdout, bytes) else str(e.stdout)
        if e.stderr:
            stderr = e.stderr.decode("utf-8", errors="replace") if isinstance(e.stderr, bytes) else str(e.stderr)

        return {
            "tool": test["name"],
            "run": run_number,
            "started_at": started_at,
            "duration_seconds": duration,
            "success": False,
            "return_code": "TIMEOUT",
            "stdout": stdout.strip(),
            "stderr": stderr.strip(),
        }

    except Exception as e:
        end = time.perf_counter()
        duration = round(end - start, 2)

        return {
            "tool": test["name"],
            "run": run_number,
            "started_at": started_at,
            "duration_seconds": duration,
            "success": False,
            "return_code": "EXCEPTION",
            "stdout": "",
            "stderr": str(e),
        }


def save_results(results: list[dict]) -> None:
    fieldnames = [
        "tool",
        "run",
        "started_at",
        "duration_seconds",
        "success",
        "return_code",
        "stdout",
        "stderr",
    ]

    with open(RESULTS_FILE, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(results)


def print_summary(results: list[dict]) -> None:
    tools = sorted(set(r["tool"] for r in results))

    print("\n" + "=" * 60)
    print("RESUMEN")
    print("=" * 60)

    for tool in tools:
        tool_results = [r for r in results if r["tool"] == tool]
        total = len(tool_results)
        successes = sum(1 for r in tool_results if r["success"])
        failures = total - successes

        durations = [r["duration_seconds"] for r in tool_results]
        avg_time = round(sum(durations) / total, 2) if total else 0
        min_time = round(min(durations), 2) if durations else 0
        max_time = round(max(durations), 2) if durations else 0

        print(f"\nHerramienta: {tool}")
        print(f"  Corridas: {total}")
        print(f"  Exitosas: {successes}")
        print(f"  Fallidas: {failures}")
        print(f"  Tasa de éxito: {round((successes / total) * 100, 2) if total else 0}%")
        print(f"  Tiempo promedio: {avg_time}s")
        print(f"  Tiempo mínimo: {min_time}s")
        print(f"  Tiempo máximo: {max_time}s")

    print("\nArchivo generado:")
    print(RESULTS_FILE)


def main() -> None:
    results = []

    for test in TESTS:
        print(f"\nProbando {test['name']}...")
        for i in range(1, RUNS_PER_TOOL + 1):
            print(f"  Corrida {i}/{RUNS_PER_TOOL}")
            result = run_test(test, i)
            results.append(result)

            status = "OK" if result["success"] else "FAIL"
            print(
                f"    [{status}] {result['tool']} - "
                f"{result['duration_seconds']}s - "
                f"return_code={result['return_code']}"
            )

            if result["stdout"]:
                print("    STDOUT:")
                print(result["stdout"])

            if result["stderr"]:
                print("    STDERR:")
                print(result["stderr"])

    save_results(results)
    print_summary(results)


if __name__ == "__main__":
    main()