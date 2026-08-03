#!/usr/bin/env python3
"""
Comparativa offline Groq (actual) vs NVIDIA Nemotron Ultra.

- Solo lectura de APIs de chat. No toca base de datos ni archivos de negocio.
- Lee claves desde marfyl-backend/.env (nunca imprime secretos).
- Uso: python3 scripts/compare-nvidia-nemotron.py
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"
OUT_PATH = Path("/tmp/marfyl-ai-compare.json")

SYSTEM = (
    "Eres el asistente de MARFYL, SaaS de POS, inventario y fiscal Venezuela. "
    "Responde en español, claro y accionable. Si faltan datos, dilo. "
    "No inventes saldos ni números de stock."
)

PROMPTS = [
    {
        "id": "ops_stock",
        "label": "Operativo inventario",
        "content": (
            "Un cajero de Monddy pregunta: '¿qué hago si el POS dice stock 0 "
            "de Ron Santa Teresa 0.75 pero hay 4 botellas en la nevera?'. "
            "Dame los pasos concretos en MARFYL (sin inventar menús inventados)."
        ),
    },
    {
        "id": "fiscal_islr",
        "label": "Fiscal ISLR",
        "content": (
            "Explica en 8-12 líneas qué riesgo hay si un negocio en Venezuela "
            "entera retenciones de ISLR fuera de plazo, y 2 acciones inmediatas. "
            "Si no tienes el artículo exacto del COT, indícalo con honestidad."
        ),
    },
    {
        "id": "agent_plan",
        "label": "Plan agente/tools",
        "content": (
            "Quiero un plan de 5 pasos (solo plan, sin ejecutar) para que un "
            "agente revise ventas de ayer, cruce con stock y detecte posibles "
            "faltantes. Indica qué tool/dato necesitaría en cada paso."
        ),
    },
]


def load_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if not path.exists():
        raise SystemExit(f"No existe {path}")
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        env[key.strip()] = val.strip().strip('"').strip("'")
    return env


def score_reply(text: str) -> dict:
    t = (text or "").strip()
    lower = t.lower()
    spanish_hits = len(
        re.findall(
            r"\b(el|la|los|las|de|que|para|si|no|paso|pasos|debe|riesgo|stock|factura)\b",
            lower,
        )
    )
    inventa = bool(
        re.search(r"\b(stock actual(?: es)?|hay \d{2,} unidades|saldo exacto)\b", lower)
    )
    actionable = len(re.findall(r"(?:^|\n)\s*(?:\d+[\).]|[-*])\s+", t))
    return {
        "chars": len(t),
        "spanish_signal": spanish_hits,
        "lists_or_steps": actionable,
        "possible_hallucinated_numbers": inventa,
        "mentions_venezuela_or_cot": bool(
            re.search(r"\b(venezuela|cot|seniat|islr|retenci[oó]n)\b", lower)
        ),
    }


def call_openai_compat(
    *,
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict],
    max_tokens: int,
    temperature: float,
    extra_body: dict | None = None,
    timeout: float = 180.0,
) -> dict:
    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "top_p": 0.95,
        "max_tokens": max_tokens,
        "stream": False,
    }
    if extra_body:
        payload.update(extra_body)

    started = time.perf_counter()
    with httpx.Client(timeout=timeout) as client:
        r = client.post(
            f"{base_url.rstrip('/')}/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            json=payload,
        )
    latency_ms = int((time.perf_counter() - started) * 1000)

    if r.status_code >= 400:
        return {
            "ok": False,
            "latency_ms": latency_ms,
            "error": f"HTTP {r.status_code}: {r.text[:500]}",
            "content": "",
            "reasoning": "",
        }

    data = r.json()
    choice = (data.get("choices") or [{}])[0]
    msg = choice.get("message") or {}
    content = msg.get("content") or ""
    reasoning = msg.get("reasoning_content") or ""
    usage = data.get("usage") or {}
    return {
        "ok": True,
        "latency_ms": latency_ms,
        "content": content,
        "reasoning": reasoning,
        "usage": usage,
        "finish_reason": choice.get("finish_reason"),
    }


def main() -> int:
    env = {**os.environ, **load_env(ENV_PATH)}

    groq_key = env.get("GROQ_API_KEY", "").strip()
    groq_fast = env.get("GROQ_MODEL", "llama-3.1-8b-instant").strip()
    groq_strong = env.get("MARFYL_MODEL", "llama-3.3-70b-versatile").strip()
    nvidia_key = env.get("NVIDIA_API_KEY", "").strip()
    nvidia_base = env.get(
        "NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1"
    ).strip()
    nvidia_model = env.get(
        "NVIDIA_MODEL", "nvidia/nemotron-3-ultra-550b-a55b"
    ).strip()

    if not groq_key:
        print("Falta GROQ_API_KEY en .env", file=sys.stderr)
        return 1
    if not nvidia_key:
        print("Falta NVIDIA_API_KEY en .env", file=sys.stderr)
        return 1

    models = [
        {
            "name": f"groq/{groq_fast}",
            "provider": "groq",
            "base_url": "https://api.groq.com/openai/v1",
            "api_key": groq_key,
            "model": groq_fast,
            "max_tokens": 1200,
            "extra_body": None,
        },
        {
            "name": f"groq/{groq_strong}",
            "provider": "groq",
            "base_url": "https://api.groq.com/openai/v1",
            "api_key": groq_key,
            "model": groq_strong,
            "max_tokens": 1200,
            "extra_body": None,
        },
        {
            "name": nvidia_model if nvidia_model.startswith("nvidia/") else f"nvidia/{nvidia_model}",
            "provider": "nvidia",
            "base_url": nvidia_base,
            "api_key": nvidia_key,
            "model": nvidia_model,
            # Presupuesto moderado para prueba usable (tu snippet usa 16k).
            "max_tokens": 4096,
            "extra_body": {
                "chat_template_kwargs": {"enable_thinking": True},
                "reasoning_budget": 4096,
            },
        },
    ]

    report = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "note": "Prueba offline: no modifica datos MARFYL.",
        "results": [],
    }

    print("Comparativa MARFYL AI — Groq vs NVIDIA Nemotron Ultra")
    print("(sin tocar BD ni inventario)\n")

    for prompt in PROMPTS:
        print(f"## {prompt['label']} ({prompt['id']})")
        messages = [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": prompt["content"]},
        ]
        row = {"prompt_id": prompt["id"], "label": prompt["label"], "models": {}}

        for m in models:
            print(f"  → {m['name']} ...", flush=True)
            result = call_openai_compat(
                base_url=m["base_url"],
                api_key=m["api_key"],
                model=m["model"],
                messages=messages,
                max_tokens=m["max_tokens"],
                temperature=0.3 if m["provider"] != "nvidia" else 1.0,
                extra_body=m["extra_body"],
                timeout=240.0 if m["provider"] == "nvidia" else 90.0,
            )
            scored = score_reply(result.get("content", ""))
            entry = {
                **result,
                "scores": scored,
                # Guarda preview corto para revisión humana
                "preview": (result.get("content") or result.get("error") or "")[:700],
            }
            # No guardar reasoning completo si es enorme; solo tamaño
            entry["reasoning_chars"] = len(result.get("reasoning") or "")
            if "reasoning" in entry:
                del entry["reasoning"]
            row["models"][m["name"]] = entry
            status = "OK" if result.get("ok") else "FAIL"
            print(
                f"     {status}  {result.get('latency_ms')} ms  "
                f"{scored.get('chars', 0)} chars"
            )

        report["results"].append(row)
        print()

    OUT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Reporte JSON: {OUT_PATH}")

    # Resumen tabular
    print("\n=== RESUMEN ===")
    for row in report["results"]:
        print(f"\n[{row['label']}]")
        for name, data in row["models"].items():
            if not data.get("ok"):
                print(f"  {name}: ERROR — {data.get('error', '')[:120]}")
                continue
            s = data["scores"]
            print(
                f"  {name}: {data['latency_ms']} ms | "
                f"{s['chars']} chars | pasos={s['lists_or_steps']} | "
                f"es_signal={s['spanish_signal']} | "
                f"fiscal_kw={s['mentions_venezuela_or_cot']}"
            )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
