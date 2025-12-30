import IntaSend from 'intasend-node';
import logger from '../../config/logger';
import { normalizePhoneNumber, validatePhoneNumber } from '../../utils/phoneNormalizer';
import { PaymentError, IntaSendSTKResponse } from '../../types/payment';
import dotenv from 'dotenv';

dotenv.config();

/**
 * IntaSendService handles M-Pesa STK Push payments via IntaSend
 */
class IntaSendService {
  private client: IntaSend | null = null;

  /**
   * Validates that required configuration is present and initializes client
   * Called before any API operation
   * @throws PaymentError if configuration is missing
   */
  private ensureClient(): void {
    if (this.client) {
      return; // Already initialized
    }

    const publishableKey = process.env.INTASEND_PUBLISHABLE_KEY;
    const secretKey = process.env.INTASEND_SECRET_KEY;
    const isTest = process.env.INTASEND_IS_TEST === 'true';

    if (!publishableKey || !secretKey) {
      throw new PaymentError(
        'IntaSend credentials not configured. Set INTASEND_PUBLISHABLE_KEY and INTASEND_SECRET_KEY',
        'CONFIG_ERROR',
        'INTASEND'
      );
    }

    // Initialize IntaSend client
    // Third parameter is test mode (boolean)
    this.client = new IntaSend(publishableKey, secretKey, isTest);
  }

  /**
   * Initiates an M-Pesa STK Push payment
   * @param phone - Phone number (will be normalized to 254xxxxxxxxx)
   * @param amount - Amount in KES (number, not string)
   * @param apiRef - API reference for tracking (typically booking ID)
   * @returns Invoice ID and status
   * @throws PaymentError if the operation fails
   */
  async initiateSTKPush(
    phone: string,
    amount: number,
    apiRef: string
  ): Promise<IntaSendSTKResponse> {
    try {
      // Ensure client is initialized (lazy validation)
      this.ensureClient();

      // Validate phone number format
      if (!validatePhoneNumber(phone)) {
        throw new PaymentError(
          `Invalid phone number format: ${phone}`,
          'INVALID_PHONE',
          'INTASEND'
        );
      }

      // Normalize phone number to 254xxxxxxxxx format
      const normalizedPhone = normalizePhoneNumber(phone);

      logger.info(`Initiating STK Push: phone=${normalizedPhone}, amount=${amount}, apiRef=${apiRef}`);

      // Trigger STK Push using IntaSend SDK
      const response = await this.client!.collection().mpesaStkPush({
        phone: normalizedPhone,
        amount: amount,
        api_ref: apiRef,
      });

      // Log raw response for debugging
      logger.debug('IntaSend STK Push response:', JSON.stringify(response, null, 2));

      // Extract invoice ID and status from response
      // IntaSend response structure may vary, check multiple possible fields
      const invoiceId = 
        response?.invoice?.invoice_id || 
        response?.invoice_id || 
        response?.invoice?.id ||
        response?.id ||
        response?.invoiceId;

      const status = 
        response?.invoice?.state || 
        response?.status || 
        response?.state ||
        'PENDING';

      if (!invoiceId) {
        throw new PaymentError(
          'IntaSend response missing invoice ID',
          'INVALID_RESPONSE',
          'INTASEND',
          response
        );
      }

      logger.info(`STK Push initiated successfully: invoiceId=${invoiceId}, status=${status}`);

      return {
        invoiceId: String(invoiceId),
        status: String(status),
      };
    } catch (error: any) {
      // Log detailed error information
      logger.error('IntaSend STK Push failed:', {
        error: error instanceof Error ? {
          message: error.message,
          name: error.name,
          stack: error.stack,
        } : error,
        rawError: error,
      });

      // Handle known error types
      if (error instanceof PaymentError) {
        throw error;
      }

      // Try to extract error details from IntaSend SDK error
      let errorMessage = 'Unknown error';
      let errorCode = 'STK_PUSH_FAILED';
      let errorDetails: any = error;

      // Check if error has response data
      if (error?.response) {
        const responseData = error.response;
        logger.error('IntaSend Request HTTP Error Code:', responseData.status || responseData.statusCode);
        
        // Try to parse error data (might be Buffer, string, or object)
        let parsedError: any = null;
        
        if (Buffer.isBuffer(responseData.data)) {
          try {
            parsedError = JSON.parse(responseData.data.toString());
          } catch (e) {
            // If parsing fails, try to extract as string
            parsedError = { raw: responseData.data.toString() };
          }
        } else if (typeof responseData.data === 'string') {
          try {
            parsedError = JSON.parse(responseData.data);
          } catch (e) {
            parsedError = { message: responseData.data };
          }
        } else {
          parsedError = responseData.data;
        }

        // Extract error message from parsed error
        if (parsedError) {
          logger.error('IntaSend Error Response:', JSON.stringify(parsedError, null, 2));
          
          // Check for error in different formats
          if (parsedError.errors && Array.isArray(parsedError.errors) && parsedError.errors.length > 0) {
            const firstError = parsedError.errors[0];
            errorMessage = firstError.detail || firstError.message || firstError.code || errorMessage;
            errorCode = firstError.code || errorCode;
            
            // Check for business eligibility error
            if (errorMessage.includes('not eligible') || errorMessage.includes('eligibility')) {
              errorCode = 'BUSINESS_NOT_ELIGIBLE';
              errorMessage = 'Your IntaSend business account is not eligible to process transactions. Please complete your business verification and submit required documents in the IntaSend dashboard.';
            }
          } else if (parsedError.message) {
            errorMessage = parsedError.message;
          } else if (parsedError.error) {
            errorMessage = parsedError.error;
          } else if (parsedError.detail) {
            errorMessage = parsedError.detail;
          }
          
          errorDetails = parsedError;
        }
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }

      throw new PaymentError(
        `IntaSend STK Push failed: ${errorMessage}`,
        errorCode,
        'INTASEND',
        errorDetails
      );
    }
  }
}

// Export singleton instance
export const intaSendService = new IntaSendService();

