"""Compatibility entrypoint for the current Numina distribution packager."""
from pathlib import Path
import runpy
runpy.run_path(str(Path(__file__).with_name("package-distributions.py")), run_name="__main__")
