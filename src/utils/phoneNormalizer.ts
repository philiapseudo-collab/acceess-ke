/**
 * Normalizes a phone number to the format 254xxxxxxxxx
 * Handles inputs like: 0712345678, +254712345678, 254712345678
 * 
 * @param phoneNumber - The phone number in any format
 * @returns Normalized phone number in format 254xxxxxxxxx
 * @throws Error if the phone number format is invalid
 */
export function normalizePhoneNumber(phoneNumber: string): string {
  // Remove all whitespace and special characters except + and digits
  const cleaned = phoneNumber.replace(/[\s-]/g, '');
  
  // Remove leading + if present
  const withoutPlus = cleaned.startsWith('+') ? cleaned.slice(1) : cleaned;
  
  // Handle different formats
  if (withoutPlus.startsWith('254')) {
    // Already in 254 format
    return withoutPlus;
  } else if (withoutPlus.startsWith('0')) {
    // Kenyan format starting with 0 (e.g., 0712345678)
    return '254' + withoutPlus.slice(1);
  } else if (withoutPlus.length === 9) {
    // 9 digits without prefix (e.g., 712345678)
    return '254' + withoutPlus;
  } else {
    throw new Error(`Invalid phone number format: ${phoneNumber}`);
  }
}

/**
 * Validates if a phone number matches the Kenyan phone number pattern
 * Regex: ^(?:254|\+254|0)?([17](?:(?:[0-9][0-9])|(?:0[0-8])|(?:4[0-8]))[0-9]{6})$
 * 
 * @param phoneNumber - The phone number to validate
 * @returns true if valid, false otherwise
 */
export function validatePhoneNumber(phoneNumber: string): boolean {
  const regex = /^(?:254|\+254|0)?([17](?:(?:[0-9][0-9])|(?:0[0-8])|(?:4[0-8]))[0-9]{6})$/;
  return regex.test(phoneNumber.replace(/[\s-]/g, ''));
}

