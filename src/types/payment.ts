/**
 * Payment error class for handling payment-specific errors
 */
export class PaymentError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly provider: 'INTASEND' | 'PESAPAL',
    public readonly originalError?: unknown
  ) {
    super(message);
    this.name = 'PaymentError';
    Object.setPrototypeOf(this, PaymentError.prototype);
  }
}

/**
 * IntaSend STK Push response
 */
export interface IntaSendSTKResponse {
  invoiceId: string;
  status: string;
}

/**
 * PesaPal authentication response
 */
export interface PesaPalAuthResponse {
  token: string;
  expires_in: number;
}

/**
 * PesaPal IPN registration response
 */
export interface PesaPalIPNResponse {
  ipn_id: string;
  url: string;
}

/**
 * PesaPal order submission request payload
 */
export interface PesaPalOrderRequest {
  id: string;
  currency: string;
  amount: number;
  description?: string;
  callback_url: string;
  notification_id: string;
  billing_address: {
    email_address: string;
    phone_number: string;
    country_code: string;
    first_name: string;
    last_name: string;
    middle_name?: string;
    line_1?: string;
    line_2?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    zip_code?: string;
  };
}

/**
 * PesaPal order submission response
 */
export interface PesaPalOrderResponse {
  order_tracking_id: string;
  merchant_reference: string;
  redirect_url: string;
  status: string;
}

/**
 * Booking DTO for payment processing
 */
export interface BookingPaymentDTO {
  id: string;
  amount: number;
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
}

