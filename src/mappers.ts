import type {
  FileHutchFile, CreatedUpload, ManifestEntry, ManifestPage, Project, StorageConnection, Transform,
  UploadAuthorization, UploadPolicy,
} from "./types.js"

// The API speaks snake_case. Converting it blindly would also rewrite keys that
// belong to the caller — metadata, transform names, PUT headers — so every
// resource is mapped by hand and those maps are passed through untouched.

type Json = Record<string, any>

export function toFile(data: Json): FileHutchFile {
  return {
    id: data.id,
    object: "file",
    filename: data.filename,
    contentType: data.content_type,
    byteSize: data.byte_size,
    checksum: data.checksum ?? null,
    visibility: data.visibility,
    status: data.status,
    metadata: data.metadata ?? {},
    policy: data.policy ?? null,
    environment: data.environment ?? null,
    storageConnectionId: data.storage_connection_id,
    url: data.url ?? null,
    transforms: data.transforms ?? {},
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  }
}

export function toUploadPolicy(data: Json): UploadPolicy {
  return {
    id: data.id,
    object: "upload_policy",
    name: data.name,
    allowedContentTypes: data.allowed_content_types ?? [],
    maximumSize: data.maximum_size,
    visibility: data.visibility,
    createdAt: data.created_at,
  }
}

export function toTransform(data: Json): Transform {
  return {
    id: data.id,
    object: "transform",
    name: data.name,
    width: data.width ?? null,
    height: data.height ?? null,
    fit: data.fit,
    quality: data.quality ?? null,
    format: data.format ?? null,
    createdAt: data.created_at,
  }
}

export function toStorageConnection(data: Json): StorageConnection {
  return {
    id: data.id,
    object: "storage_connection",
    name: data.name,
    mode: data.mode,
    provider: data.provider,
    status: data.status,
  }
}

export function toProject(data: Json): Project {
  return {
    id: data.id,
    object: "project",
    name: data.name,
    teamId: data.team_id,
    environment: data.environment ? { id: data.environment.id, name: data.environment.name } : null,
    environments: data.environments ?? [],
    storageReady: data.storage_ready === true,
    activeStorageConnection: data.active_storage_connection
      ? toStorageConnection(data.active_storage_connection)
      : null,
    uploadPolicies: (data.upload_policies ?? []).map(toUploadPolicy),
    transforms: (data.transforms ?? []).map(toTransform),
    plan: data.plan
      ? { key: data.plan.key, name: data.plan.name, storageBytes: data.plan.storage_bytes, projectLimit: data.plan.project_limit ?? null }
      : null,
    usage: data.usage ? { storageBytesUsed: data.usage.storage_bytes_used, projectsUsed: data.usage.projects_used } : null,
    createdAt: data.created_at,
  }
}

export function toManifestEntry(data: Json): ManifestEntry {
  return {
    id: data.id,
    filename: data.filename,
    contentType: data.content_type,
    byteSize: data.byte_size,
    checksum: data.checksum ?? null,
    visibility: data.visibility,
    status: data.status,
    metadata: data.metadata ?? {},
    policy: data.policy ?? null,
    environment: data.environment ?? null,
    storage: {
      connectionId: data.storage.connection_id,
      mode: data.storage.mode,
      provider: data.storage.provider,
      bucket: data.storage.bucket ?? null,
      endpoint: data.storage.endpoint ?? null,
      region: data.storage.region ?? null,
      key: data.storage.key,
    },
    createdAt: data.created_at,
  }
}

export function toManifestPage(data: Json): ManifestPage {
  return {
    environment: data.environment,
    generatedAt: data.generated_at,
    files: (data.files ?? []).map(toManifestEntry),
    hasMore: data.has_more === true,
    nextAfter: data.next_after ?? null,
  }
}

export function toUploadAuthorization(data: Json): UploadAuthorization {
  return {
    id: data.id,
    object: "upload",
    fileId: data.file_id ?? data.id,
    method: data.method,
    url: data.url,
    headers: data.headers ?? {}, // storage's own header names; never rewritten
    expiresAt: data.expires_at,
  }
}

export function toCreatedUpload(data: Json): CreatedUpload {
  return { upload: toUploadAuthorization(data.upload), file: toFile(data.file) }
}
