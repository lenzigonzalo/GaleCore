"""¿El pedido es una definición inequívoca («qué es un put credit spread»)? Ese turno no necesita ni la capacidad de
vigilar mercado ni el mercado precargado (WS-0050). Ante cualquier duda, falso: el turno queda como hoy.

Por la forma, no por una lista de temas (feedback de Codex, 19/10): «explicame» solo no alcanza («explicame por qué
cayó…», «explicame eso»); el sujeto tiene que empezar con artículo (descarta «qué es lo que está pasando…», «qué es
nvda») y ser corto; una preposición seguida de una palabra corta sin artículo puede ser un símbolo en minúsculas
(«el GEX de spy»)."""
import re
import unicodedata
from pathlib import Path

NOT_TICKERS = {"OK", "EPS", "IV", "HV", "ETF", "USD", "EEUU", "NY", "PCS", "CCS", "IC", "GEX", "CPI", "FOMC", "PBI",
               "DTE", "OTM", "ITM", "ATM", "IA", "AI", "CEO", "YO", "Y", "A", "O", "SEC", "PE", "UTC", "NFP",
               "HOY", "SI", "NO", "VS", "ES", "EN", "DE", "LA", "EL", "QUE", "UN", "MI", "TU", "PARA", "CON", "POR"}
_OPENER = re.compile(r"^(?:explica(?:me)?\s+|explicar\s+)?"
                     r"(?:que es|que son|que significa|como funciona|para que sirve)\s+")
_ARTICLE = {"un", "una", "unos", "unas", "el", "la", "los", "las"}
_PREPOSITION = {"de", "del", "en", "con", "sobre", "a", "al"}
_PERSONAL = re.compile(r"\b(?:cuenta|cartera|posicion|posiciones|mi|mis|hoy|ahora|actual|actuales|conviene|deberia"
                       r"|ayer|manana|semana|mes|esto|eso|este|esta|anterior|antes|recien|ultimo|ultima|proximo"
                       r"|proxima|nuevo|nueva|mercado|ticker)\b")
_CLAUSE = {"que", "entre"}  # «el spread que vimos», «el spread entre spy y qqq»: no es una definición suelta
MAX_WORDS = 8  # «un put credit spread con un ejemplo» = 7


def _plain(text):
    return "".join(c for c in unicodedata.normalize("NFD", text.lower()) if unicodedata.category(c) != "Mn")


def es_concepto(prompt, cwd):
    text = re.sub(r"^[\s¿¡]+", "", _plain(prompt)).strip()
    opener = _OPENER.match(text)
    if not opener or _PERSONAL.search(text) or "strategies" in Path(cwd or ".").parts:
        return False
    words = re.findall(r"[a-z0-9]+", text[opener.end():])
    if not words or len(words) > MAX_WORDS or words[0] not in _ARTICLE or _CLAUSE & set(words):
        return False
    pairs = zip(words, words[1:], strict=False)
    if any(w in _PREPOSITION and nxt not in _ARTICLE and len(nxt) <= 5 for w, nxt in pairs):
        return False
    return not any(w.lstrip("$") not in NOT_TICKERS for w in re.findall(r"\$?\b[A-Z]{1,5}\b", prompt))
