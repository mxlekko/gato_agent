from __future__ import annotations

import re
from dataclasses import dataclass
from typing import TYPE_CHECKING

import numpy as np

from rag_mvp.parsers import ParsedBlock, ParsedDocument

if TYPE_CHECKING:
    from rag_mvp.embeddings import DashScopeEmbedder


@dataclass
class SemanticChunkConfig:
    min_chars: int = 280
    max_chars: int = 900
    overlap_chars: int = 80
    similarity_threshold: float = 0.58

    def validate(self) -> None:
        if self.min_chars <= 0:
            raise ValueError("min_chars must be positive")
        if self.max_chars <= self.min_chars:
            raise ValueError("max_chars must be greater than min_chars")
        if self.overlap_chars < 0:
            raise ValueError("overlap_chars must be non-negative")
        if not 0 <= self.similarity_threshold <= 1:
            raise ValueError("similarity_threshold must be between 0 and 1")


@dataclass
class TextChunk:
    chunk_id: str
    index: int
    text: str
    char_count: int
    unit_count: int
    start_block_index: int
    end_block_index: int
    strategy: str = "semantic"


@dataclass
class SemanticUnit:
    text: str
    block_type: str
    source_block_index: int

    @property
    def char_count(self) -> int:
        return len(self.text)

    @property
    def is_heading(self) -> bool:
        return self.block_type == "heading"


def semantic_chunk_document(
    document: ParsedDocument,
    embedder: DashScopeEmbedder,
    config: SemanticChunkConfig,
) -> list[TextChunk]:
    config.validate()
    units = _build_units(document.blocks, max_chars=config.max_chars)
    if not units:
        return []

    embeddings = [np.asarray(vector, dtype=np.float32) for vector in embedder.embed_documents([unit.text for unit in units])]

    chunks: list[TextChunk] = []
    current_units: list[SemanticUnit] = []
    current_vectors: list[np.ndarray] = []

    for unit, vector in zip(units, embeddings):
        if unit.is_heading and current_units:
            _finalize_chunk(chunks, document.doc_id, current_units)
            current_units, current_vectors = [], []

        if not current_units:
            current_units = [unit]
            current_vectors = [vector]
            continue

        projected_units = current_units + [unit]
        projected_chars = len(_join_unit_texts(projected_units))
        current_chars = len(_join_unit_texts(current_units))
        similarity = _cosine_similarity(_centroid(current_vectors), vector)

        should_split = False
        if projected_chars > config.max_chars:
            should_split = True
        elif current_chars >= config.min_chars and similarity < config.similarity_threshold:
            should_split = True

        if should_split:
            _finalize_chunk(chunks, document.doc_id, current_units)
            overlap_units, overlap_vectors = _tail_overlap(current_units, current_vectors, config.overlap_chars)
            current_units = [] if unit.is_heading else overlap_units
            current_vectors = [] if unit.is_heading else overlap_vectors

            if current_units and len(_join_unit_texts(current_units + [unit])) > config.max_chars:
                current_units, current_vectors = [], []

        current_units.append(unit)
        current_vectors.append(vector)

    if current_units:
        _finalize_chunk(chunks, document.doc_id, current_units)

    return chunks


def _build_units(blocks: list[ParsedBlock], max_chars: int) -> list[SemanticUnit]:
    units: list[SemanticUnit] = []
    for block in blocks:
        if block.block_type == "heading":
            units.append(
                SemanticUnit(
                    text=block.text,
                    block_type=block.block_type,
                    source_block_index=block.index,
                )
            )
            continue

        if block.char_count <= max_chars:
            units.append(
                SemanticUnit(
                    text=block.text,
                    block_type=block.block_type,
                    source_block_index=block.index,
                )
            )
            continue

        for piece in _split_block_text(block.text, max_chars=max_chars):
            units.append(
                SemanticUnit(
                    text=piece,
                    block_type=block.block_type,
                    source_block_index=block.index,
                )
            )
    return units


def _split_block_text(text: str, max_chars: int) -> list[str]:
    fragments: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        pieces = [piece.strip() for piece in re.split(r"(?<=[。！？!?；;.!?])", stripped) if piece.strip()]
        fragments.extend(pieces or [stripped])

    if not fragments:
        return _hard_split(text, max_chars)

    units: list[str] = []
    current = ""
    for fragment in fragments:
        candidate = fragment if not current else f"{current} {fragment}"
        if len(candidate) <= max_chars:
            current = candidate
            continue

        if current:
            units.append(current)
            current = ""

        if len(fragment) <= max_chars:
            current = fragment
        else:
            units.extend(_hard_split(fragment, max_chars))

    if current:
        units.append(current)
    return units


def _hard_split(text: str, max_chars: int) -> list[str]:
    return [text[index : index + max_chars].strip() for index in range(0, len(text), max_chars) if text[index : index + max_chars].strip()]


def _join_unit_texts(units: list[SemanticUnit]) -> str:
    return "\n\n".join(unit.text for unit in units)


def _centroid(vectors: list[np.ndarray]) -> np.ndarray:
    return np.mean(np.stack(vectors), axis=0)


def _cosine_similarity(left: np.ndarray, right: np.ndarray) -> float:
    denominator = float(np.linalg.norm(left) * np.linalg.norm(right))
    if denominator == 0:
        return 0.0
    return float(np.dot(left, right) / denominator)


def _tail_overlap(
    units: list[SemanticUnit],
    vectors: list[np.ndarray],
    overlap_chars: int,
) -> tuple[list[SemanticUnit], list[np.ndarray]]:
    if overlap_chars <= 0:
        return [], []

    kept_units: list[SemanticUnit] = []
    kept_vectors: list[np.ndarray] = []
    collected_chars = 0

    for unit, vector in zip(reversed(units), reversed(vectors)):
        if unit.is_heading:
            break
        kept_units.insert(0, unit)
        kept_vectors.insert(0, vector)
        collected_chars += unit.char_count
        if collected_chars >= overlap_chars:
            break

    return kept_units, kept_vectors


def _finalize_chunk(chunks: list[TextChunk], doc_id: str, units: list[SemanticUnit]) -> None:
    text = _join_unit_texts(units)
    chunks.append(
        TextChunk(
            chunk_id=f"{doc_id}:{len(chunks)}",
            index=len(chunks),
            text=text,
            char_count=len(text),
            unit_count=len(units),
            start_block_index=min(unit.source_block_index for unit in units),
            end_block_index=max(unit.source_block_index for unit in units),
        )
    )
