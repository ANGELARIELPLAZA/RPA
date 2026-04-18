import cv2
import numpy as np
import mss
import time
import threading
from pathlib import Path


class WindowRecorder:
    def __init__(self, filename="videos/selenium/test.mp4", fps=10, region_getter=None, output_size=(1366, 900)):
        self.filename = filename
        self.fps = fps
        self.region_getter = region_getter
        self.output_size = output_size
        self.running = False
        self.thread = None

    def start(self):
        Path(self.filename).parent.mkdir(parents=True, exist_ok=True)
        self.running = True
        self.thread = threading.Thread(target=self._record, daemon=True)
        self.thread.start()

    def _record(self):
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        out = cv2.VideoWriter(self.filename, fourcc, self.fps, self.output_size)

        with mss.mss() as sct:
            try:
                while self.running:
                    region = self.region_getter() if self.region_getter else None
                    if not region:
                        time.sleep(0.05)
                        continue

                    monitor = {
                        "left": int(region["left"]),
                        "top": int(region["top"]),
                        "width": max(1, int(region["width"])),
                        "height": max(1, int(region["height"])),
                    }

                    img = np.array(sct.grab(monitor))
                    frame = cv2.cvtColor(img, cv2.COLOR_BGRA2BGR)

                    # Mantener un solo archivo y un solo tamaño de salida
                    frame = cv2.resize(frame, self.output_size)

                    out.write(frame)
                    time.sleep(1 / self.fps)
            finally:
                out.release()

    def stop(self):
        self.running = False
        if self.thread:
            self.thread.join(timeout=5)