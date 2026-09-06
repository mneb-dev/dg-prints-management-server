import { paymentMethodStore } from '../data/paymentMethodStore.js';
import { createCatalogRouter } from './catalogRoutes.js';

export default createCatalogRouter(paymentMethodStore, 'Payment method');
