import axios, { AxiosInstance } from 'axios';
import dotenv from 'dotenv';
import logger from '../../config/logger';
import {
  PaymentError,
  PesaPalAuthResponse,
  PesaPalIPNResponse,
  PesaPalOrderRequest,
  PesaPalOrderResponse,
  BookingPaymentDTO,
} from '../../types/payment';

dotenv.config();

/**
 * PesaPalService handles card payments via PesaPal V3 API
 * Implements token caching and lazy IPN registration
 */
class PesaPalService {
  private axiosInstance: AxiosInstance;
  private token: string | null = null;
  private tokenExpiry: number | null = null;
  private ipnId: string | null = null;

  private readonly baseUrl: string;
  private readonly consumerKey: string;
  private readonly consumerSecret: string;
  private readonly callbackUrl: string;

  constructor() {
    this.baseUrl = process.env.PESAPAL_BASE_URL || 'https://pay.pesapal.com/v3/api';
    this.consumerKey = process.env.PESAPAL_CONSUMER_KEY || '';
    this.consumerSecret = process.env.PESAPAL_CONSUMER_SECRET || '';
    
    // Try to auto-detect callback URL from environment, fallback to explicit config
    const explicitCallbackUrl = process.env.PESAPAL_CALLBACK_URL;
    const railwayPublicDomain = process.env.RAILWAY_PUBLIC_DOMAIN;
    const railwayServiceUrl = process.env.RAILWAY_SERVICE_URL;
    
    if (explicitCallbackUrl) {
      this.callbackUrl = explicitCallbackUrl;
    } else if (railwayPublicDomain) {
      // Railway provides public domain - construct callback URL
      this.callbackUrl = `https://${railwayPublicDomain}/webhooks/pesapal`;
    } else if (railwayServiceUrl) {
      // Railway service URL (might be internal, but try it)
      this.callbackUrl = `${railwayServiceUrl}/webhooks/pesapal`;
    } else {
      // No callback URL available
      this.callbackUrl = '';
    }

    // Initialize Axios instance (validation happens on first use)
    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });
  }

  /**
   * Validates that required configuration is present
   * Called before any API operation
   * @throws PaymentError if configuration is missing
   */
  private validateConfig(): void {
    if (!this.consumerKey || !this.consumerSecret) {
      throw new PaymentError(
        'PesaPal credentials not configured. Set PESAPAL_CONSUMER_KEY and PESAPAL_CONSUMER_SECRET',
        'CONFIG_ERROR',
        'PESAPAL'
      );
    }

    if (!this.callbackUrl) {
      const errorMessage = 
        'PesaPal callback URL not configured. ' +
        'Set PESAPAL_CALLBACK_URL environment variable to your webhook endpoint. ' +
        'Example: https://your-domain.com/webhooks/pesapal ' +
        '(Railway users: Set PESAPAL_CALLBACK_URL=https://your-app.railway.app/webhooks/pesapal)';
      
      throw new PaymentError(
        errorMessage,
        'CONFIG_ERROR',
        'PESAPAL'
      );
    }
  }

  /**
   * Gets or refreshes the PesaPal access token
   * Implements proactive refresh (30 seconds before expiry)
   * @returns Access token
   * @throws PaymentError if authentication fails
   */
  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    const thirtySeconds = 30 * 1000;

    // Check if token exists and is still valid (with 30-second buffer)
    if (this.token && this.tokenExpiry && now < this.tokenExpiry - thirtySeconds) {
      logger.debug('Using cached PesaPal token');
      return this.token;
    }

    try {
      logger.info('Refreshing PesaPal access token');

      // Request new token
      const response = await this.axiosInstance.post<PesaPalAuthResponse>(
        '/Auth/RequestToken',
        {
          consumer_key: this.consumerKey,
          consumer_secret: this.consumerSecret,
        }
      );

      if (!response.data.token) {
        throw new PaymentError(
          'PesaPal authentication failed: No token in response',
          'AUTH_FAILED',
          'PESAPAL',
          response.data
        );
      }

      // Cache token and calculate expiry
      this.token = response.data.token;
      const expiresIn = response.data.expires_in || 3600; // Default to 1 hour if not provided
      this.tokenExpiry = now + expiresIn * 1000;

      logger.info(`PesaPal token refreshed. Expires in ${expiresIn} seconds`);

      return this.token;
    } catch (error) {
      logger.error('PesaPal token refresh failed:', error);

      if (error instanceof PaymentError) {
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new PaymentError(
        `PesaPal authentication failed: ${errorMessage}`,
        'AUTH_FAILED',
        'PESAPAL',
        error
      );
    }
  }

  /**
   * Gets or registers the IPN (Instant Payment Notification) ID
   * Implements lazy registration pattern
   * @param token - Access token
   * @returns IPN ID
   * @throws PaymentError if IPN registration fails
   */
  private async getIpnId(token: string): Promise<string> {
    // Return cached IPN ID if available
    if (this.ipnId) {
      logger.debug('Using cached PesaPal IPN ID');
      return this.ipnId;
    }

    try {
      logger.info('Registering PesaPal IPN');

      const response = await this.axiosInstance.post<PesaPalIPNResponse>(
        '/URLSetup/RegisterIPN',
        {
          url: this.callbackUrl,
          ipn_notification_type: 'POST',
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.data.ipn_id) {
        throw new PaymentError(
          'PesaPal IPN registration failed: No IPN ID in response',
          'IPN_REGISTRATION_FAILED',
          'PESAPAL',
          response.data
        );
      }

      // Cache IPN ID
      this.ipnId = response.data.ipn_id;

      logger.info(`PesaPal IPN registered: ${this.ipnId}`);

      return this.ipnId;
    } catch (error) {
      logger.error('PesaPal IPN registration failed:', error);

      if (error instanceof PaymentError) {
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new PaymentError(
        `PesaPal IPN registration failed: ${errorMessage}`,
        'IPN_REGISTRATION_FAILED',
        'PESAPAL',
        error
      );
    }
  }

  /**
   * Generates a PesaPal payment link for card payments
   * @param booking - Booking DTO with payment details
   * @returns Redirect URL for payment
   * @throws PaymentError if payment link generation fails
   */
  async getPaymentLink(booking: BookingPaymentDTO): Promise<string> {
    try {
      // Validate configuration
      this.validateConfig();

      // Step 1: Get access token
      const token = await this.getAccessToken();

      // Step 2: Get IPN ID (lazy registration)
      const ipnId = await this.getIpnId(token);

      // Step 3: Construct order request payload
      const orderRequest: PesaPalOrderRequest = {
        id: booking.id,
        currency: 'KES',
        amount: booking.amount,
        description: `Event ticket booking - ${booking.id}`,
        notification_id: ipnId,
        callback_url: this.callbackUrl,
        billing_address: {
          email_address: booking.email,
          phone_number: booking.phone,
          country_code: 'KE',
          first_name: booking.firstName,
          last_name: booking.lastName,
        },
      };

      logger.info(`Submitting PesaPal order: bookingId=${booking.id}, amount=${booking.amount}`);

      // Step 4: Submit order request
      const response = await this.axiosInstance.post<PesaPalOrderResponse>(
        '/Transactions/SubmitOrderRequest',
        orderRequest,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      // Log raw response for debugging
      logger.debug('PesaPal order response:', JSON.stringify(response.data, null, 2));

      if (!response.data.redirect_url) {
        throw new PaymentError(
          'PesaPal order submission failed: No redirect URL in response',
          'ORDER_SUBMISSION_FAILED',
          'PESAPAL',
          response.data
        );
      }

      logger.info(`PesaPal payment link generated: ${response.data.redirect_url}`);

      // Step 5: Return redirect URL
      return response.data.redirect_url;
    } catch (error) {
      logger.error('PesaPal payment link generation failed:', error);

      if (error instanceof PaymentError) {
        throw error;
      }

      // Handle Axios errors
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const data = error.response?.data;

        throw new PaymentError(
          `PesaPal API error: ${error.message}`,
          status === 401 ? 'AUTH_FAILED' : 'API_ERROR',
          'PESAPAL',
          { status, data }
        );
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new PaymentError(
        `PesaPal payment link generation failed: ${errorMessage}`,
        'PAYMENT_LINK_FAILED',
        'PESAPAL',
        error
      );
    }
  }

  /**
   * Gets the transaction status for a PesaPal order
   * @param orderTrackingId - The order tracking ID from PesaPal
   * @returns Transaction status response
   * @throws PaymentError if the operation fails
   */
  async getTransactionStatus(orderTrackingId: string): Promise<any> {
    try {
      // Validate configuration
      this.validateConfig();

      // Get access token
      const token = await this.getAccessToken();

      logger.info(`Getting PesaPal transaction status: orderTrackingId=${orderTrackingId}`);

      // GET transaction status
      const response = await this.axiosInstance.get(
        `/Transactions/GetTransactionStatus?orderTrackingId=${orderTrackingId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      // Log raw response for debugging
      logger.debug('PesaPal transaction status response:', JSON.stringify(response.data, null, 2));

      return response.data;
    } catch (error) {
      logger.error('PesaPal transaction status check failed:', error);

      if (error instanceof PaymentError) {
        throw error;
      }

      // Handle Axios errors
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const data = error.response?.data;

        throw new PaymentError(
          `PesaPal transaction status check failed: ${error.message}`,
          status === 401 ? 'AUTH_FAILED' : 'STATUS_CHECK_FAILED',
          'PESAPAL',
          { status, data }
        );
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new PaymentError(
        `PesaPal transaction status check failed: ${errorMessage}`,
        'STATUS_CHECK_FAILED',
        'PESAPAL',
        error
      );
    }
  }
}

// Export singleton instance
export const pesaPalService = new PesaPalService();

