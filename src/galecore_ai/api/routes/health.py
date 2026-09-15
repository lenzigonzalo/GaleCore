"""Health check endpoint."""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "service": "galecore-ai",
        "version": "0.1.0",
    }
