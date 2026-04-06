// Helper function to extract UID from filename (if following XNAT naming convention)
export function extractUIDFromFilename(url: string): string | null {
    if (!url) return null;
    try {
      // Extract the filename from the URL path
      const parts = url.split('/');
      const filename = parts[parts.length - 1];
      
      // Generate a unique SOPInstanceUID based on the timestamp and random number
      // Don't attempt to extract from filename as it contains StudyInstanceUID, not SOPInstanceUID
      const sopUID = `2.25.${Date.now()}.${Math.floor(Math.random() * 1000000)}`;
      return sopUID;
    } catch (e) {
      console.warn('Error generating SOPInstanceUID:', e);
      return generateRandomUID();
    }
  }
  
export function extractStudyUIDFromURL(url: string): string | null {
    if (!url) return null;
    try {
      // Extract the filename from the URL path
      const parts = url.split('/');
      const filename = parts[parts.length - 1];
      const studyUIDMatch = filename.match(/(\d+\.\d+\.\d+\.\d+(?:\.\d+)*)/);
      return studyUIDMatch ? studyUIDMatch[1] : null;
    } catch (e) {
      console.warn('Error extracting study UID from URL:', e);
      return null;
    }
  }
  // Generate a random UID as a last resort
export function generateRandomUID(): string {
    // Simple random UID generator for fallback
    return `2.25.${Math.floor(Math.random() * 100000000)}.${Date.now()}`;
  }

/**
 * Deterministic UID generator from an input string.
 * Used to keep SOPInstanceUID stable across reloads when XNAT metadata
 * is missing SOPInstanceUID for some instances.
 *
 * Format: 2.25.<hash>.<salt>
 */
export function generateUIDFromString(input: string, salt = 0): string {
  const str = String(input ?? '');

  // FNV-1a 32-bit hash
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  // Convert to unsigned and keep it within UID component limits
  const unsigned = hash >>> 0;
  return `2.25.${unsigned}.${salt}`;
}