import subprocess
import unittest
from pathlib import Path


class PreferencesContractTests(unittest.TestCase):
    def test_preferences_contract(self):
        root = Path(__file__).resolve().parents[1]
        subprocess.run(['node', '--test', 'scripts/test_preferences_contract.mjs'], cwd=root, check=True, capture_output=True, text=True)
