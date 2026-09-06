import { orderChannelStore } from '../data/orderChannelStore.js';
import { createCatalogRouter } from './catalogRoutes.js';

export default createCatalogRouter(orderChannelStore, 'Order channel');
