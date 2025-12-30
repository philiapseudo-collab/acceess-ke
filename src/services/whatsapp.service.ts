import axios, { AxiosInstance, AxiosError } from 'axios';
import FormData from 'form-data';
import dotenv from 'dotenv';
import logger from '../config/logger';
import { AppError } from '../utils/AppError';
import { normalizePhoneNumber } from '../utils/phoneNormalizer';
import {
  WaApiResponse,
  WaServiceResponse,
  WaButton,
  WaListSection,
} from '../types/whatsapp';

dotenv.config();

/**
 * WhatsAppService handles communication with WhatsApp Cloud API
 */
class WhatsAppService {
  private axiosInstance: AxiosInstance;
  private readonly baseUrl: string;
  private readonly phoneNumberId: string;
  private readonly accessToken: string;
  private readonly apiVersion: string;

  constructor() {
    this.apiVersion = process.env.WA_API_VERSION || 'v18.0';
    this.phoneNumberId = process.env.WA_PHONE_NUMBER_ID || '';
    this.accessToken = process.env.WA_ACCESS_TOKEN || '';

    // Build base URL (validation happens on first use)
    this.baseUrl = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId || 'PLACEHOLDER'}`;

    // Initialize Axios instance
    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Validates that required configuration is present
   * Called before any API operation
   * @throws AppError if configuration is missing
   */
  private validateConfig(): void {
    if (!this.phoneNumberId || !this.accessToken) {
      throw new AppError(
        'WhatsApp credentials not configured. Set WA_PHONE_NUMBER_ID and WA_ACCESS_TOKEN',
        500
      );
    }

    // Update axios base URL if it was using placeholder
    if (this.axiosInstance.defaults.baseURL?.includes('PLACEHOLDER')) {
      this.axiosInstance.defaults.baseURL = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}`;
    }
  }

  /**
   * Private helper to send requests to WhatsApp API
   * Handles authentication and error extraction
   */
  private async sendRequest(
    endpoint: string,
    payload: any
  ): Promise<WaApiResponse> {
    try {
      const response = await this.axiosInstance.post<WaApiResponse>(
        endpoint,
        payload,
        {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
          },
        }
      );

      return response.data;
    } catch (error) {
      logger.error('WhatsApp API error:', {
        endpoint,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      // Extract Meta error message
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError<any>;
        const metaError = axiosError.response?.data?.error;

        if (metaError) {
          const errorMessage = metaError.message || 'WhatsApp API error';
          const errorCode = metaError.code || 'UNKNOWN';
          const errorType = metaError.type || 'UNKNOWN';

          // Log full error details for debugging
          logger.error('WhatsApp API error details:', {
            code: errorCode,
            type: errorType,
            message: errorMessage,
            subcode: metaError.error_subcode,
            fbtrace_id: metaError.fbtrace_id,
            responseData: axiosError.response?.data,
          });

          throw new AppError(
            `WhatsApp API error (${errorType}): ${errorMessage}`,
            500
          );
        }
      }

      // Fallback for non-Meta errors
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new AppError(`WhatsApp API request failed: ${errorMessage}`, 500);
    }
  }

  /**
   * Sends a simple text message
   * @param to - Recipient phone number (will be normalized)
   * @param body - Message text
   * @returns Message ID
   */
  async sendText(to: string, body: string): Promise<WaServiceResponse> {
    try {
      // Validate configuration
      this.validateConfig();

      // Normalize phone number
      const normalizedTo = normalizePhoneNumber(to);

      logger.info(`Sending WhatsApp text message to ${normalizedTo}`);

      const payload = {
        messaging_product: 'whatsapp',
        to: normalizedTo,
        type: 'text',
        text: {
          body: body,
        },
      };

      const response = await this.sendRequest('/messages', payload);

      if (!response.messages || response.messages.length === 0) {
        throw new AppError('WhatsApp API returned no message ID', 500);
      }

      const messageId = response.messages[0].id;

      logger.info(`WhatsApp message sent: messageId=${messageId}`);

      return { messageId };
    } catch (error) {
      logger.error(`Failed to send WhatsApp text message to ${to}:`, error);
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        `Failed to send WhatsApp message: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500
      );
    }
  }

  /**
   * Sends an interactive message with buttons
   * @param to - Recipient phone number (will be normalized)
   * @param body - Message text
   * @param buttons - Array of buttons (max 3)
   * @returns Message ID
   */
  async sendButtons(
    to: string,
    body: string,
    buttons: WaButton[]
  ): Promise<WaServiceResponse> {
    try {
      // Validate configuration
      this.validateConfig();

      // Validate button limit
      if (buttons.length > 3) {
        throw new AppError('Maximum 3 buttons allowed', 500);
      }

      if (buttons.length === 0) {
        throw new AppError('At least one button is required', 500);
      }

      // Normalize phone number
      const normalizedTo = normalizePhoneNumber(to);

      logger.info(`Sending WhatsApp buttons to ${normalizedTo}, buttonCount=${buttons.length}`);

      const payload = {
        messaging_product: 'whatsapp',
        to: normalizedTo,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: {
            text: body,
          },
          action: {
            buttons: buttons.map((btn) => ({
              type: 'reply',
              reply: {
                id: btn.id,
                title: btn.title,
              },
            })),
          },
        },
      };

      const response = await this.sendRequest('/messages', payload);

      if (!response.messages || response.messages.length === 0) {
        throw new AppError('WhatsApp API returned no message ID', 500);
      }

      const messageId = response.messages[0].id;

      logger.info(`WhatsApp buttons sent: messageId=${messageId}`);

      return { messageId };
    } catch (error) {
      logger.error(`Failed to send WhatsApp buttons to ${to}:`, error);
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        `Failed to send WhatsApp buttons: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500
      );
    }
  }

  /**
   * Sends an interactive message with a list
   * @param to - Recipient phone number (will be normalized)
   * @param body - Message text
   * @param buttonText - Text for the list button
   * @param sections - Array of sections (max 10 rows total across all sections)
   * @returns Message ID
   */
  async sendList(
    to: string,
    body: string,
    buttonText: string,
    sections: WaListSection[]
  ): Promise<WaServiceResponse> {
    try {
      // Validate configuration
      this.validateConfig();

      // Validate total rows limit (max 10 rows total)
      const totalRows = sections.reduce((sum, section) => sum + section.rows.length, 0);

      if (totalRows > 10) {
        throw new AppError(
          `Maximum 10 rows allowed across all sections. Found ${totalRows}`,
          500
        );
      }

      if (totalRows === 0) {
        throw new AppError('At least one row is required', 500);
      }

      // Normalize phone number
      const normalizedTo = normalizePhoneNumber(to);

      // Validate and truncate button text (max 20 chars)
      const truncatedButtonText = buttonText.length > 20 ? buttonText.substring(0, 17) + '...' : buttonText;

      logger.info(
        `Sending WhatsApp list to ${normalizedTo}, sections=${sections.length}, totalRows=${totalRows}`
      );

      // Format sections with proper length limits
      // WhatsApp limits: title max 24 chars, description max 72 chars, button max 20 chars
      const formattedSections = sections.map((section) => ({
        title: section.title.length > 24 ? section.title.substring(0, 21) + '...' : section.title,
        rows: section.rows.map((row) => ({
          id: row.id.length > 200 ? row.id.substring(0, 197) + '...' : row.id, // ID max 200 chars
          title: row.title.length > 24 ? row.title.substring(0, 21) + '...' : row.title, // Title max 24 chars
          description: row.description && row.description.length > 72 
            ? row.description.substring(0, 69) + '...' 
            : row.description || '', // Description max 72 chars, required field
        })),
      }));

      const payload = {
        messaging_product: 'whatsapp',
        to: normalizedTo,
        type: 'interactive',
        interactive: {
          type: 'list',
          body: {
            text: body,
          },
          // Footer is optional - only include if buttonText is different from footer text
          // Remove footer to avoid potential issues
          action: {
            button: truncatedButtonText,
            sections: formattedSections,
          },
        },
      };

      const response = await this.sendRequest('/messages', payload);

      if (!response.messages || response.messages.length === 0) {
        throw new AppError('WhatsApp API returned no message ID', 500);
      }

      const messageId = response.messages[0].id;

      logger.info(`WhatsApp list sent: messageId=${messageId}`);

      return { messageId };
    } catch (error) {
      logger.error(`Failed to send WhatsApp list to ${to}:`, error);
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        `Failed to send WhatsApp list: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500
      );
    }
  }

  /**
   * Marks a message as read
   * @param messageId - The message ID from the webhook payload
   * @returns Success indicator
   */
  async markAsRead(messageId: string): Promise<void> {
    try {
      // Validate configuration (but don't throw - marking as read is non-critical)
      if (!this.phoneNumberId || !this.accessToken) {
        logger.warn('Cannot mark message as read: WhatsApp credentials not configured');
        return;
      }

      logger.debug(`Marking WhatsApp message as read: messageId=${messageId}`);

      const payload = {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      };

      await this.sendRequest('/messages', payload);

      logger.debug(`WhatsApp message marked as read: messageId=${messageId}`);
    } catch (error) {
      logger.error(`Failed to mark WhatsApp message as read: messageId=${messageId}`, error);
      // Don't throw - marking as read is not critical
      // Log and continue
    }
  }

  /**
   * Uploads media (image, document, etc.) to WhatsApp servers
   * @param fileBuffer - The file buffer to upload
   * @param mimeType - MIME type of the file (e.g., 'image/png')
   * @returns Media ID for use in sendImage or other media messages
   * @throws AppError if upload fails or validation fails
   */
  async uploadMedia(fileBuffer: Buffer, mimeType: string): Promise<string> {
    // Validate configuration
    this.validateConfig();

    // Validate inputs
    if (!fileBuffer || fileBuffer.length === 0) {
      throw new AppError('File buffer is required for media upload', 400);
    }

    if (!mimeType) {
      throw new AppError('MIME type is required for media upload', 400);
    }

    try {
      // Create FormData with file
      const form = new FormData();
      form.append('messaging_product', 'whatsapp');
      form.append('file', fileBuffer, {
        filename: 'ticket.png',
        contentType: mimeType,
      });

      // Build media upload URL
      const uploadUrl = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/media`;

      logger.info(`Uploading media to WhatsApp, size=${fileBuffer.length} bytes, type=${mimeType}`);

      // Upload with merged headers (form headers + authorization)
      const response = await axios.post(uploadUrl, form, {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${this.accessToken}`,
        },
      });

      if (!response.data || !response.data.id) {
        throw new AppError('WhatsApp API returned no media ID', 500);
      }

      const mediaId = response.data.id;

      logger.info(`Media uploaded successfully: mediaId=${mediaId}`);

      return mediaId;
    } catch (error) {
      logger.error('Media upload failed:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        mimeType,
        bufferSize: fileBuffer.length,
      });

      // Extract Meta error if available
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError<any>;
        const metaError = axiosError.response?.data?.error;

        if (metaError) {
          const errorMessage = metaError.message || 'WhatsApp media upload error';
          const errorType = metaError.type || 'UNKNOWN';

          logger.error('WhatsApp media upload error details:', {
            code: metaError.code,
            type: errorType,
            message: errorMessage,
          });

          throw new AppError(
            `WhatsApp media upload failed (${errorType}): ${errorMessage}`,
            500
          );
        }
      }

      throw new AppError(
        `Failed to upload media: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500
      );
    }
  }

  /**
   * Sends an image message with an uploaded media ID
   * @param to - Recipient phone number (will be normalized)
   * @param mediaId - Media ID from uploadMedia()
   * @param caption - Optional caption for the image
   * @returns Message ID
   * @throws AppError if send fails or validation fails
   */
  async sendImage(
    to: string,
    mediaId: string,
    caption?: string
  ): Promise<WaServiceResponse> {
    try {
      // Validate configuration
      this.validateConfig();

      // Validate mediaId
      if (!mediaId) {
        throw new AppError('Media ID is required for sending image', 400);
      }

      // Normalize phone number
      const normalizedTo = normalizePhoneNumber(to);

      logger.info(`Sending WhatsApp image to ${normalizedTo}, mediaId=${mediaId}`);

      const payload: any = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: normalizedTo,
        type: 'image',
        image: {
          id: mediaId,
        },
      };

      // Add caption if provided (pass through without truncation)
      if (caption) {
        payload.image.caption = caption;
      }

      const response = await this.sendRequest('/messages', payload);

      if (!response.messages || response.messages.length === 0) {
        throw new AppError('WhatsApp API returned no message ID', 500);
      }

      const messageId = response.messages[0].id;

      logger.info(`WhatsApp image sent: messageId=${messageId}`);

      return { messageId };
    } catch (error) {
      logger.error(`Failed to send WhatsApp image to ${to}:`, error);
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        `Failed to send WhatsApp image: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500
      );
    }
  }
}

// Export singleton instance
export default new WhatsAppService();

