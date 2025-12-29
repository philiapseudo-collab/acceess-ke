import axios, { AxiosInstance, AxiosError } from 'axios';
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

    if (!this.phoneNumberId || !this.accessToken) {
      throw new Error(
        'WhatsApp credentials not configured. Set WA_PHONE_NUMBER_ID and WA_ACCESS_TOKEN'
      );
    }

    this.baseUrl = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}`;

    // Initialize Axios instance
    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Content-Type': 'application/json',
      },
    });
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

      logger.info(
        `Sending WhatsApp list to ${normalizedTo}, sections=${sections.length}, totalRows=${totalRows}`
      );

      const payload = {
        messaging_product: 'whatsapp',
        to: normalizedTo,
        type: 'interactive',
        interactive: {
          type: 'list',
          body: {
            text: body,
          },
          footer: {
            text: buttonText,
          },
          action: {
            button: buttonText,
            sections: sections.map((section) => ({
              title: section.title,
              rows: section.rows.map((row) => ({
                id: row.id,
                title: row.title,
                description: row.description,
              })),
            })),
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
}

// Export singleton instance
export default new WhatsAppService();

