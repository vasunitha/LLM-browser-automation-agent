/**
 * Filesystem artifact store (Phase 5).
 *
 * One JSON file per artifact, named "{id}.json". Deliberately not a
 * database: artifacts are small, versioned, human-reviewable files meant
 * to be committed to git (see artifacts/*.json), so a plain directory is
 * the right amount of infrastructure — not another storage system.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Artifact } from "./types";
import { validateArtifact } from "./validate";
import { toJson, fromJson } from "./serialize";

const DEFAULT_ARTIFACTS_DIR = "./artifacts";

export class ArtifactStore {
  private readonly dir: string;

  constructor(dir: string = DEFAULT_ARTIFACTS_DIR) {
    this.dir = dir;
  }

  private filePath(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  /** Validates before writing — refuses to persist an artifact that wouldn't itself load cleanly. */
  save(artifact: Artifact): void {
    const result = validateArtifact(artifact);
    if (!result.valid) {
      const summary = result.errors.map((e) => `${e.path}: ${e.message}`).join("; ");
      const id = isRecordWithId(artifact) ? artifact.id : "(unknown id)";
      throw new Error(`Refusing to save invalid artifact "${id}": ${summary}`);
    }
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true });
    }
    writeFileSync(this.filePath(result.artifact.id), toJson(result.artifact), "utf8");
  }

  load(id: string): Artifact {
    const path = this.filePath(id);
    if (!existsSync(path)) {
      throw new Error(`Artifact "${id}" was not found in the store at "${this.dir}".`);
    }
    const json = readFileSync(path, "utf8");
    const result = fromJson(json);
    if (!result.valid) {
      const summary = result.errors.map((e) => `${e.path}: ${e.message}`).join("; ");
      throw new Error(`Artifact file "${id}.json" failed validation: ${summary}`);
    }
    return result.artifact;
  }

  exists(id: string): boolean {
    return existsSync(this.filePath(id));
  }

  /** Returns artifact IDs present in the store, sorted for deterministic output. */
  list(): string[] {
    if (!existsSync(this.dir)) {
      return [];
    }
    return readdirSync(this.dir)
      .filter((file) => file.endsWith(".json"))
      .map((file) => file.slice(0, -".json".length))
      .sort();
  }
}

function isRecordWithId(value: unknown): value is { id: string } {
  return typeof value === "object" && value !== null && "id" in value;
}
