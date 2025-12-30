import QRCode from 'qrcode';
import logger from '../../config/logger';
import { AppError } from '../../utils/AppError';

/**
 * QrCodeService handles QR code generation for tickets
 * Generates PNG buffers optimized for scanning in low-light conditions
 */
class QrCodeService {
  /**
   * Generates a QR code PNG buffer for a ticket unique code
   * @param uniqueCode - The unique ticket code (e.g., "NYE-8832-XJ")
   * @returns Promise<Buffer> - PNG image buffer ready for upload
   * @throws AppError if generation fails or code is invalid
   */
  async generateTicketCode(uniqueCode: string): Promise<Buffer> {
    // Fail fast: validate input
    if (!uniqueCode) {
      throw new AppError('Unique code is required for QR generation', 400);
    }

    try {
      const buffer = await QRCode.toBuffer(uniqueCode, {
        type: 'png',
        errorCorrectionLevel: 'H', // High error correction for low-light scanning
        margin: 2,
        width: 400,
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      });

      logger.debug(`QR code generated successfully for ticket: ${uniqueCode}`);
      return buffer;
    } catch (error) {
      // Log the specific failure with context
      logger.error('QR code generation failed:', {
        uniqueCode,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });

      // Throw standardized AppError for calling service to handle
      throw new AppError(
        `Failed to generate QR code for ticket ${uniqueCode}`,
        500
      );
    }
  }
}

// Export singleton instance
export default new QrCodeService();

