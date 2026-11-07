"""Vercel 서버 함수 — 가린 문장 여러 개를 Gemini 로 가른다.

열쇠는 환경 변수 GEMINI_API_KEY 에서만 읽는다. 코드와 파일에는 적지 않는다.
모델은 GEMINI_MODEL (비어 있으면 gemini-3.5-flash-lite).
파이썬 표준 라이브러리만 쓴다.

요청:  POST /api/classify  {"sentences": ["가린 문장", ...]}
응답:  {"ok": true,  "model": "...", "results": [{"칸": "...", "긴급도": "...", "이유": "..."} | {"error": "..."}]}
       {"ok": false, "error": "실패 이유"}
"""

import json
import os
import socket
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler

DEFAULT_MODEL = "gemini-3.5-flash-lite"
TIMEOUT_SECONDS = 60
MAX_SENTENCES = 20
MAX_CHARS = 500

HERE = os.path.dirname(os.path.abspath(__file__))
CRITERIA_PATH = os.path.join(HERE, "..", "criteria.json")


def load_criteria():
    with open(CRITERIA_PATH, encoding="utf-8") as f:
        return json.load(f)


def build_prompt(criteria, sentences):
    lines = [
        "너는 사내 IT 요청을 가르는 분류기다. 아래 기준만 따른다.",
        "",
        "주제: " + criteria.get("주제", ""),
        "",
        "칸 (위에서부터 순서대로):",
    ]
    for c in criteria["칸"]:
        lines.append("- " + c["이름"] + (" — " + c["정의"] if c.get("정의") else ""))
    lines.append("순서 규칙: " + criteria.get("순서_규칙", ""))
    for r in criteria.get("덧붙인_규칙", []):
        lines.append("덧붙인 규칙: " + r)
    lines += ["", "긴급도:"]
    for u in criteria["긴급도"]:
        lines.append("- " + u["이름"] + " — " + u["정의"])
    lines += [
        "",
        "문장 속 [이름] [전화번호] [사번] 은 가려 둔 자리다.",
        "문장마다 칸 · 긴급도 · 이유 한 줄(한국어, 40자 안팎)을 낸다.",
        "i 는 받은 번호 그대로 돌려준다.",
        "",
        "문장:",
    ]
    for i, s in enumerate(sentences):
        lines.append(json.dumps({"i": i, "문장": s}, ensure_ascii=False))
    return "\n".join(lines)


def response_schema(criteria):
    return {
        "type": "OBJECT",
        "properties": {
            "결과": {
                "type": "ARRAY",
                "items": {
                    "type": "OBJECT",
                    "properties": {
                        "i": {"type": "INTEGER"},
                        "칸": {"type": "STRING", "enum": criteria["순서"]},
                        "긴급도": {"type": "STRING", "enum": [u["이름"] for u in criteria["긴급도"]]},
                        "이유": {"type": "STRING"},
                    },
                    "required": ["i", "칸", "긴급도", "이유"],
                },
            }
        },
        "required": ["결과"],
    }


def call_gemini(api_key, model, prompt, schema):
    url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent"
    body = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": schema,
        },
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    try:
        text = data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, TypeError):
        reason = (data.get("promptFeedback") or {}).get("blockReason") or "답이 비어 있음"
        raise ValueError("Gemini 답을 읽지 못했습니다: " + str(reason))
    return json.loads(text)


def classify(sentences):
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        return 500, {"ok": False, "error": "GEMINI_API_KEY 환경 변수가 없습니다"}
    model = os.environ.get("GEMINI_MODEL", "").strip() or DEFAULT_MODEL

    try:
        criteria = load_criteria()
    except Exception as e:  # noqa: BLE001
        return 500, {"ok": False, "error": "criteria.json 을 읽지 못했습니다: " + str(e)}

    try:
        out = call_gemini(api_key, model, build_prompt(criteria, sentences), response_schema(criteria))
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = json.loads(e.read().decode("utf-8")).get("error", {}).get("message", "")
        except Exception:  # noqa: BLE001
            pass
        return 502, {"ok": False, "error": "Gemini 오류 " + str(e.code) + (": " + detail[:200] if detail else "")}
    except (socket.timeout, TimeoutError):
        return 504, {"ok": False, "error": str(TIMEOUT_SECONDS) + "초 안에 Gemini 답이 오지 않았습니다"}
    except urllib.error.URLError as e:
        return 502, {"ok": False, "error": "Gemini 에 닿지 못했습니다: " + str(e.reason)}
    except (ValueError, json.JSONDecodeError) as e:
        return 502, {"ok": False, "error": str(e)}

    cats = set(criteria["순서"])
    urgs = {u["이름"] for u in criteria["긴급도"]}
    by_i = {}
    for r in (out or {}).get("결과", []):
        if isinstance(r, dict) and isinstance(r.get("i"), int):
            by_i[r["i"]] = r

    results = []
    for i in range(len(sentences)):
        r = by_i.get(i)
        if not r:
            results.append({"error": "이 문장의 답이 없습니다"})
        elif r.get("칸") not in cats or r.get("긴급도") not in urgs:
            results.append({"error": "기준에 없는 칸 · 긴급도: " + str(r.get("칸")) + " · " + str(r.get("긴급도"))})
        else:
            results.append({"칸": r["칸"], "긴급도": r["긴급도"], "이유": str(r.get("이유", "")).strip()})
    return 200, {"ok": True, "model": model, "results": results}


class handler(BaseHTTPRequestHandler):
    def _send(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
            data = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        except Exception:  # noqa: BLE001
            return self._send(400, {"ok": False, "error": "요청을 JSON 으로 읽지 못했습니다"})

        sentences = data.get("sentences") if isinstance(data, dict) else None
        if not isinstance(sentences, list) or not sentences or not all(isinstance(s, str) and s.strip() for s in sentences):
            return self._send(400, {"ok": False, "error": "sentences 는 빈칸이 아닌 문장 목록이어야 합니다"})
        if len(sentences) > MAX_SENTENCES:
            return self._send(400, {"ok": False, "error": "한 번에 " + str(MAX_SENTENCES) + "문장까지 보낼 수 있습니다"})
        if any(len(s) > MAX_CHARS for s in sentences):
            return self._send(400, {"ok": False, "error": "문장은 " + str(MAX_CHARS) + "자까지입니다"})

        status, payload = classify([s.strip() for s in sentences])
        return self._send(status, payload)

    def do_GET(self):
        return self._send(405, {"ok": False, "error": "POST 로 보내 주세요"})
