from __future__ import annotations

import asyncio
import os
from collections import defaultdict
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

app = FastAPI(
    title="Teleprompter Realtime API",
    version="1.0.0",
    description="Estado compartilhado e comandos em tempo real entre operador e apresentador.",
)

_default_origins = "http://localhost:5173,http://127.0.0.1:5173"
allowed_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", _default_origins).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

# Estado em memória para protótipo. Em produção, usar Redis/DB para múltiplos workers.
sessions: dict[str, dict[str, Any]] = {}
connections: dict[str, set[WebSocket]] = defaultdict(set)
session_locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)


class SessionState(BaseModel):
    selectedStory: int = Field(default=0, ge=0)
    pageIndex: int = Field(default=0, ge=0)
    paused: bool = False
    speed: float = Field(default=1.0, ge=0.5, le=2.0)
    fontSize: int = Field(default=36, ge=18, le=72)
    editorialStories: list[dict[str, Any]] = Field(default_factory=list)
    operatorOverride: bool = False


class StateUpdate(BaseModel):
    state: SessionState


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "teleprompter-realtime"}


@app.get("/api/sessions/{session_id}/state")
async def get_session_state(session_id: str) -> dict[str, Any]:
    return {"sessionId": session_id, "state": sessions.get(session_id)}


@app.post("/api/sessions/{session_id}/state")
async def update_session_state(session_id: str, update: StateUpdate) -> dict[str, Any]:
    state = update.state.model_dump()
    async with session_locks[session_id]:
        sessions[session_id] = state
        await broadcast(session_id, {"type": "state", "sessionId": session_id, "state": state, "source": "http"})
    return {"ok": True, "sessionId": session_id, "state": state}


async def broadcast(session_id: str, message: dict[str, Any], exclude: WebSocket | None = None) -> None:
    stale: list[WebSocket] = []
    for socket in list(connections[session_id]):
        if socket is exclude:
            continue
        try:
            await socket.send_json(message)
        except Exception:
            stale.append(socket)
    for socket in stale:
        connections[session_id].discard(socket)


@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str) -> None:
    await websocket.accept()
    connections[session_id].add(websocket)
    await websocket.send_json({
        "type": "welcome",
        "sessionId": session_id,
        "state": sessions.get(session_id),
        "clients": len(connections[session_id]),
    })

    try:
        while True:
            message = await websocket.receive_json()
            message_type = message.get("type")

            if message_type == "ping":
                await websocket.send_json({"type": "pong"})
                continue

            if message_type == "sync":
                raw_state = message.get("state")
                if not isinstance(raw_state, dict):
                    await websocket.send_json({"type": "error", "message": "O campo state precisa ser um objeto."})
                    continue
                try:
                    state = SessionState.model_validate(raw_state).model_dump()
                except Exception as exc:
                    await websocket.send_json({"type": "error", "message": f"Estado inválido: {exc}"})
                    continue
                async with session_locks[session_id]:
                    sessions[session_id] = state
                    await broadcast(session_id, {
                        "type": "state",
                        "sessionId": session_id,
                        "state": state,
                        "source": message.get("clientId"),
                    }, exclude=websocket)

            elif message_type == "command":
                command = message.get("command")
                allowed_commands = {"pause", "resume", "next", "previous", "select_story", "select_page", "take_control"}
                if command not in allowed_commands:
                    await websocket.send_json({"type": "error", "message": "Comando não reconhecido."})
                    continue
                raw_state = message.get("state")
                if not isinstance(raw_state, dict):
                    await websocket.send_json({"type": "error", "message": "O comando precisa incluir o estado atualizado."})
                    continue
                try:
                    state = SessionState.model_validate(raw_state).model_dump()
                except Exception as exc:
                    await websocket.send_json({"type": "error", "message": f"Estado inválido: {exc}"})
                    continue
                async with session_locks[session_id]:
                    sessions[session_id] = state
                    await broadcast(session_id, {
                        "type": "command",
                        "sessionId": session_id,
                        "command": command,
                        "state": state,
                        "source": message.get("clientId"),
                    }, exclude=websocket)
            else:
                await websocket.send_json({"type": "error", "message": "Tipo de mensagem não reconhecido."})
    except WebSocketDisconnect:
        pass
    finally:
        connections[session_id].discard(websocket)
        if not connections[session_id]:
            connections.pop(session_id, None)
