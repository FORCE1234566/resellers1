import mongoose, { Document, Schema } from 'mongoose';
import { Network, ProductType } from './Package';
import { CheckerType } from '../config/checker';
import { generateOrderNumber } from '../utils/helpers';
import { isValidOrderStatus, normalizeOrderStatus } from '../utils/orderStatus';

export type OrderStatus = 'pending' | 'processing' | 'delivered' | 'failed' | 'refunded' | 'cancelled';
export type OrderSource = 'agent' | 'agent_api' | 'reseller_store' | 'admin';
export type FulfillmentProvider = 'smartdatahub' | 'datamax';

export interface IAfaDetails {
  fullName: string;
  phone: string;
  ghanaCard: string;
  location: string;
  occupation?: string;
}

export interface ICheckerDetails {
  type: CheckerType;
  serial: string;
  pin: string;
}

export interface IOrderStatusHistory {
  step: string;
  label: string;
  message: string;
  done: boolean;
  at: Date;
}

export interface IUplineProfit {
  resellerId: mongoose.Types.ObjectId;
  profit: number;
}

export interface IOrder extends Document {
  orderId: string;
  /** Legacy field — kept in sync with orderId for production unique index (orderNumber_1). */
  orderNumber: string;
  userId?: mongoose.Types.ObjectId;
  resellerId?: mongoose.Types.ObjectId;
  agentId?: mongoose.Types.ObjectId;
  customerEmail?: string;
  network: Network;
  /** Set when an MTN Express order is auto-switched to MTN after SDH rejection. */
  originalNetwork?: Network;
  /** True after Express→MTN fallback has been attempted (prevents loops). */
  expressFallbackToMtn?: boolean;
  productType: ProductType;
  bundleSize: string;
  packageId: mongoose.Types.ObjectId;
  recipientPhone: string;
  afaDetails?: IAfaDetails;
  checkerDetails?: ICheckerDetails;
  costPrice: number;
  adminBasePrice?: number;
  sellingPrice: number;
  profit: number;
  uplineProfits?: IUplineProfit[];
  platformProfit: number;
  paystackFee: number;
  processingFee: number;
  totalAmount: number;
  status: OrderStatus;
  source: OrderSource;
  paystackReference?: string;
  promoCodeId?: mongoose.Types.ObjectId;
  promoDiscountGhs?: number;
  originalSellingPrice?: number;
  providerOrderId?: string;
  providerBatchId?: string;
  providerReference?: string;
  providerStatus?: string;
  fulfillmentProvider?: FulfillmentProvider;
  statusHistory?: IOrderStatusHistory[];
  complaintDeadline: Date;
  createdAt: Date;
  updatedAt: Date;
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

function assignOrderIdentifiers(doc: {
  orderId?: string;
  orderNumber?: string;
}): void {
  if (!isBlank(doc.orderNumber) && isBlank(doc.orderId)) {
    doc.orderId = String(doc.orderNumber).trim();
    return;
  }
  if (!isBlank(doc.orderId) && isBlank(doc.orderNumber)) {
    doc.orderNumber = String(doc.orderId).trim();
    return;
  }
  if (isBlank(doc.orderId) && isBlank(doc.orderNumber)) {
    const id = generateOrderNumber();
    doc.orderId = id;
    doc.orderNumber = id;
  }
}

const orderSchema = new Schema<IOrder>(
  {
    orderId: {
      type: String,
      required: true,
      unique: true,
      default: generateOrderNumber,
    },
    orderNumber: {
      type: String,
      required: true,
      default: generateOrderNumber,
      validate: {
        validator: (value: string) => !isBlank(value),
        message: 'orderNumber cannot be null, undefined, or empty',
      },
    },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    resellerId: { type: Schema.Types.ObjectId, ref: 'User' },
    agentId: { type: Schema.Types.ObjectId, ref: 'User' },
    customerEmail: String,
    network: { type: String, required: true },
    originalNetwork: { type: String },
    expressFallbackToMtn: { type: Boolean, default: false },
    productType: { type: String, enum: ['data', 'afa', 'checker'], default: 'data' },
    bundleSize: { type: String, required: true },
    packageId: { type: Schema.Types.ObjectId, ref: 'Package', required: true },
    recipientPhone: { type: String, required: true },
    afaDetails: {
      fullName: String,
      phone: String,
      ghanaCard: String,
      location: String,
      occupation: String,
    },
    checkerDetails: {
      type: { type: String, enum: ['bece', 'wassce'] },
      serial: String,
      pin: String,
    },
    costPrice: { type: Number, required: true },
    adminBasePrice: { type: Number },
    sellingPrice: { type: Number, required: true },
    profit: { type: Number, default: 0 },
    uplineProfits: [
      {
        resellerId: { type: Schema.Types.ObjectId, ref: 'User' },
        profit: { type: Number, default: 0 },
      },
    ],
    platformProfit: { type: Number, default: 0 },
    paystackFee: { type: Number, default: 0 },
    processingFee: { type: Number, default: 0 },
    totalAmount: { type: Number, required: true },
    status: {
      type: String,
      enum: ['pending', 'processing', 'delivered', 'failed', 'refunded', 'cancelled'],
      default: 'pending',
    },
    source: {
      type: String,
      enum: ['agent', 'agent_api', 'reseller_store', 'admin'],
      required: true,
    },
    paystackReference: String,
    promoCodeId: { type: Schema.Types.ObjectId, ref: 'PromoCode' },
    promoDiscountGhs: { type: Number, min: 0 },
    originalSellingPrice: { type: Number, min: 0 },
    providerOrderId: String,
    providerBatchId: String,
    providerReference: String,
    providerStatus: String,
    fulfillmentProvider: { type: String, enum: ['smartdatahub', 'datamax'] },
    statusHistory: [
      {
        step: String,
        label: String,
        message: String,
        done: Boolean,
        at: Date,
      },
    ],
    complaintDeadline: { type: Date, required: true },
  },
  { timestamps: true }
);

orderSchema.pre('validate', function () {
  assignOrderIdentifiers(this);
  if (!isValidOrderStatus(this.status)) {
    this.status = normalizeOrderStatus(this.status, this.providerStatus);
  }
});

orderSchema.pre('save', function () {
  assignOrderIdentifiers(this);
});

orderSchema.index({ orderId: 1 });
orderSchema.index({ orderNumber: 1 }, { unique: true, sparse: true });
orderSchema.index({ resellerId: 1, createdAt: -1 });
orderSchema.index({ agentId: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1, agentId: 1 });
orderSchema.index({ status: 1, createdAt: -1, resellerId: 1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ createdAt: -1 });
orderSchema.index({ resellerId: 1, customerEmail: 1, source: 1 });
orderSchema.index({ resellerId: 1, recipientPhone: 1, source: 1 });
orderSchema.index({ providerStatus: 1, status: 1, createdAt: 1 });
orderSchema.index({ paystackReference: 1 }, { unique: true, sparse: true });

export const Order = mongoose.model<IOrder>('Order', orderSchema);
