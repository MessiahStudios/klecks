import { IRGB } from '../kl-types';
import { BB } from '../../bb/bb';
import { THistoryEntryDataComposed } from '../history/history.types';
import { HISTORY_TILE_SIZE } from '../history/kl-history';

export class Eyedropper {
    // ----------------------------------- public -----------------------------------
    constructor() {}

    // Reads from history (ImageData) to avoid reading from canvas.
    getColorAt(x: number, y: number, composed: THistoryEntryDataComposed): IRGB {
        x = Math.floor(x);
        y = Math.floor(y);
        if (x < 0 || x >= composed.size.width || y < 0 || y >= composed.size.height) {
            return new BB.RGB(0, 0, 0);
        }

        const canvas = BB.canvas(1, 1);
        const ctx = BB.ctx(canvas, { willReadFrequently: true });
        ctx.imageSmoothingEnabled = false;

        const layerCanvas = BB.canvas(1, 1);
        const layerCtx = BB.ctx(layerCanvas);
        layerCtx.imageSmoothingEnabled = false;
        const imageData = new ImageData(1, 1);

        const tilesX = Math.ceil(composed.size.width / HISTORY_TILE_SIZE);
        const tileCol = Math.floor(x / HISTORY_TILE_SIZE);
        const tileRow = Math.floor(y / HISTORY_TILE_SIZE);
        const tileIndex = tileRow * tilesX + tileCol;

        Object.values(composed.layerMap)
            .sort((a, b) => {
                if (a.index > b.index) {
                    return 1;
                }
                if (a.index < b.index) {
                    return -1;
                }
                return 0;
            })
            .forEach((layer) => {
                if (!layer.isVisible || layer.opacity === 0) {
                    return;
                }
                const tile = layer.tiles[tileIndex];
                if (tile instanceof ImageData) {
                    let tileWidth = HISTORY_TILE_SIZE;
                    if (composed.size.width % HISTORY_TILE_SIZE !== 0 && tileCol === tilesX - 1) {
                        tileWidth = composed.size.width % HISTORY_TILE_SIZE;
                    }
                    const pixelIndex =
                        (y % HISTORY_TILE_SIZE) * tileWidth + (x % HISTORY_TILE_SIZE);

                    imageData.data[0] = tile.data[pixelIndex * 4];
                    imageData.data[1] = tile.data[pixelIndex * 4 + 1];
                    imageData.data[2] = tile.data[pixelIndex * 4 + 2];
                    imageData.data[3] = tile.data[pixelIndex * 4 + 3];
                    layerCtx.putImageData(imageData, 0, 0);
                } else {
                    layerCtx.clearRect(0, 0, 1, 1);
                    layerCtx.fillStyle = tile.fill;
                    layerCtx.fillRect(0, 0, 1, 1);
                }

                ctx.globalAlpha = layer.opacity;
                ctx.globalCompositeOperation = layer.mixModeStr;
                ctx.drawImage(layerCanvas, 0, 0);
            });

        const imData = ctx.getImageData(0, 0, 1, 1);
        return new BB.RGB(imData.data[0], imData.data[1], imData.data[2]);
    }
}
