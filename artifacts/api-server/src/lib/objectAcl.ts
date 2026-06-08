import { File } from "@google-cloud/storage";

/**
 * Lightweight per-object ACL stored as GCS custom metadata.
 *
 * Every object in PRIVATE_OBJECT_DIR carries an `owner` (the
 * appUserId who created it) and a `visibility`:
 *   - "public"  — anyone (auth or not) can READ. Used for profile
 *                 photos which are visible across the community feed.
 *   - "private" — only the owner can READ.
 *
 * We deliberately do not implement role/group rules. The product
 * surface (profile photos) only needs owner+visibility, and shipping
 * unused group machinery would be dead code.
 */

const ACL_POLICY_METADATA_KEY = "custom:aclPolicy";

export enum ObjectPermission {
  READ = "read",
  WRITE = "write",
}

export interface ObjectAclPolicy {
  owner: string;
  visibility: "public" | "private";
}

export async function setObjectAclPolicy(
  objectFile: File,
  aclPolicy: ObjectAclPolicy,
): Promise<void> {
  const [exists] = await objectFile.exists();
  if (!exists) {
    throw new Error(`Object not found: ${objectFile.name}`);
  }

  await objectFile.setMetadata({
    metadata: {
      [ACL_POLICY_METADATA_KEY]: JSON.stringify(aclPolicy),
    },
  });
}

export async function getObjectAclPolicy(
  objectFile: File,
): Promise<ObjectAclPolicy | null> {
  const [metadata] = await objectFile.getMetadata();
  const aclPolicy = metadata?.metadata?.[ACL_POLICY_METADATA_KEY];
  if (!aclPolicy) {
    return null;
  }
  try {
    return JSON.parse(aclPolicy as string) as ObjectAclPolicy;
  } catch {
    return null;
  }
}

export async function canAccessObject({
  userId,
  objectFile,
  requestedPermission,
}: {
  userId?: string;
  objectFile: File;
  requestedPermission: ObjectPermission;
}): Promise<boolean> {
  const aclPolicy = await getObjectAclPolicy(objectFile);
  if (!aclPolicy) {
    // Objects uploaded before ACLs were attached are treated as
    // private-to-no-one. Refusing access here is the safe default.
    return false;
  }

  if (
    aclPolicy.visibility === "public" &&
    requestedPermission === ObjectPermission.READ
  ) {
    return true;
  }

  if (!userId) {
    return false;
  }

  return aclPolicy.owner === userId;
}
