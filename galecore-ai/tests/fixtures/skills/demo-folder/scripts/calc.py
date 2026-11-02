import json
import sys

print(json.dumps({"suma": sum(int(a) for a in sys.argv[1:]), "cwd": __import__("os").getcwd()[-11:]}))
