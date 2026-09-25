import { Router, type NextFunction, type Response } from 'express';

import {
  addProductImage,
  createUploadTarget,
  deleteProductImage,
  ProductImageError,
  reorderProductImages,
} from '../data/productImageStore.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { isUuid } from '../utils/uuid.js';

// Mounted at /api/products/:id/images. Only admins and superadmins manage product images.
const router = Router({ mergeParams: true });

router.use(requireAuth, requireRole('admin', 'superadmin'));

router.use((req, res, next) => {
  const { id } = req.params as { id?: string };
  if (!isUuid(id)) {
    res.status(404).json({ error: `Product not found: ${id}` });
    return;
  }
  next();
});

function handleError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof ProductImageError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  next(err);
}

router.post('/upload-url', async (req, res, next) => {
  try {
    const { id } = req.params as { id: string };
    res.json(await createUploadTarget(id));
  } catch (err) {
    handleError(err, res, next);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { id } = req.params as { id: string };
    const path = req.body?.path;
    if (typeof path !== 'string' || path.length === 0) {
      res.status(400).json({ error: '"path" is required' });
      return;
    }
    res.status(201).json(await addProductImage(id, path));
  } catch (err) {
    handleError(err, res, next);
  }
});

router.put('/order', async (req, res, next) => {
  try {
    const { id } = req.params as { id: string };
    const imageIds = req.body?.imageIds;
    if (!Array.isArray(imageIds) || !imageIds.every(isUuid)) {
      res.status(400).json({ error: '"imageIds" must be an array of image ids' });
      return;
    }
    res.json(await reorderProductImages(id, imageIds));
  } catch (err) {
    handleError(err, res, next);
  }
});

router.delete('/:imageId', async (req, res, next) => {
  try {
    const { id, imageId } = req.params as { id: string; imageId: string };
    if (!isUuid(imageId) || !(await deleteProductImage(id, imageId))) {
      res.status(404).json({ error: `Image not found: ${imageId}` });
      return;
    }
    res.status(204).send();
  } catch (err) {
    handleError(err, res, next);
  }
});

export default router;
