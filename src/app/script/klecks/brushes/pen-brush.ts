import { BB } from '../../bb/bb';
import { ALPHA_IM_ARR } from './brushes-common';
import { IRGB, TPressureInput } from '../kl-types';
import { BezierLine } from '../../bb/math/line';
import { KlHistory } from '../history/kl-history';
import { getPushableLayerChange } from '../history/push-helpers/get-pushable-layer-change';
import { IBounds } from '../../bb/bb-types';
import { canvasAndChangedTilesToLayerTiles } from '../history/push-helpers/canvas-to-layer-tiles';
import { getChangedTiles, updateChangedTiles } from '../history/push-helpers/changed-tiles';

const ALPHA_CIRCLE = 0;
const ALPHA_CHALK = 1;
const ALPHA_CAL = 2; // calligraphy
const ALPHA_SQUARE = 3;

const TWO_PI = 2 * Math.PI;

export class PenBrush {
    private context: CanvasRenderingContext2D = {} as CanvasRenderingContext2D;
    private klHistory: KlHistory = {} as KlHistory;

    private settingHasOpacityPressure: boolean = false;
    private settingHasScatterPressure: boolean = false;
    private settingHasSizePressure: boolean = true;
    private settingSize: number = 2;
    private settingSpacing: number = 0.8489;
    private settingOpacity: number = 1;
    private settingScatter: number = 0;
    private settingColor: IRGB = {} as IRGB;
    private settingColorStr: string = '';
    private settingAlphaId: number = ALPHA_CIRCLE;
    private settingLockLayerAlpha: boolean = false;

    private hasDrawnDot: boolean = false;
    private lineToolLastDot: number = 0;
    private lastInput: TPressureInput = { x: 0, y: 0, pressure: 0 };
    private lastInput2: TPressureInput = { x: 0, y: 0, pressure: 0 };
    private inputArr: TPressureInput[] = [];
    private inputIsDrawing: boolean = false;
    private bezierLine: BezierLine | null = null;

    // mipmapping
    private readonly alphaCanvas128: HTMLCanvasElement = BB.canvas(128, 128);
    private readonly alphaCanvas64: HTMLCanvasElement = BB.canvas(64, 64);
    private readonly alphaCanvas32: HTMLCanvasElement = BB.canvas(32, 32);
    private readonly alphaOpacityArr: number[] = [1, 0.9, 1, 1];

    private changedTiles: boolean[] = [];

    private updateChangedTiles(bounds: IBounds) {
        this.changedTiles = updateChangedTiles(
            this.changedTiles,
            getChangedTiles(bounds, this.context.canvas.width, this.context.canvas.height),
        );
    }

    private updateAlphaCanvas() {
        if (this.settingAlphaId === ALPHA_CIRCLE || this.settingAlphaId === ALPHA_SQUARE) {
            return;
        }

        const instructionArr: [HTMLCanvasElement, number][] = [
            [this.alphaCanvas128, 128],
            [this.alphaCanvas64, 64],
            [this.alphaCanvas32, 32],
        ];

        let ctx;

        for (let i = 0; i < instructionArr.length; i++) {
            ctx = BB.ctx(instructionArr[i][0] as any);

            ctx.save();
            ctx.clearRect(0, 0, instructionArr[i][1], instructionArr[i][1]);

            ctx.fillStyle =
                'rgba(' +
                this.settingColor.r +
                ', ' +
                this.settingColor.g +
                ', ' +
                this.settingColor.b +
                ', ' +
                this.alphaOpacityArr[this.settingAlphaId] +
                ')';
            ctx.fillRect(0, 0, instructionArr[i][1], instructionArr[i][1]);

            ctx.globalCompositeOperation = 'destination-in';
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(
                ALPHA_IM_ARR[this.settingAlphaId],
                0,
                0,
                instructionArr[i][1],
                instructionArr[i][1],
            );

            ctx.restore();
        }
    }

    private calcOpacity(pressure: number): number {
        return this.settingOpacity * (this.settingHasOpacityPressure ? pressure * pressure : 1);
    }

    private calcScatter(pressure: number): number {
        return (
            this.settingScatter * this.settingSize * (this.settingHasScatterPressure ? pressure : 1)
        );
    }

    /**
     * @param x
     * @param y
     * @param size
     * @param opacity
     * @param scatter
     * @param angle
     * @param before - [x, y, size, opacity, angle] the drawDot call before
     */
    private drawDot(
        x: number,
        y: number,
        size: number,
        opacity: number,
        scatter: number,
        angle?: number,
        before?: [number, number, number, number, number, number | undefined],
    ): void {
        if (size <= 0) {
            return;
        }

        if (this.settingLockLayerAlpha) {
            this.context.globalCompositeOperation = 'source-atop';
        }

        if (!before || before[3] !== opacity) {
            this.context.globalAlpha = opacity;
        }

        if (
            !before &&
            (this.settingAlphaId === ALPHA_CIRCLE || this.settingAlphaId === ALPHA_SQUARE)
        ) {
            this.context.fillStyle = this.settingColorStr;
        }

        if (scatter > 0) {
            // scatter equally distributed over area of a circle
            const scatterAngleRad = Math.random() * 2 * Math.PI;
            const distance = Math.sqrt(Math.random()) * scatter;
            x += Math.cos(scatterAngleRad) * distance;
            y += Math.sin(scatterAngleRad) * distance;
        }

        const boundsSize =
            this.settingAlphaId === ALPHA_CIRCLE || this.settingAlphaId === ALPHA_CAL
                ? size
                : size * Math.sqrt(2);
        this.updateChangedTiles({
            x1: Math.floor(x - boundsSize),
            y1: Math.floor(y - boundsSize),
            x2: Math.ceil(x + boundsSize),
            y2: Math.ceil(y + boundsSize),
        });

        if (this.settingAlphaId === ALPHA_CIRCLE) {
            this.context.beginPath();
            this.context.arc(x, y, size, 0, TWO_PI);
            this.context.closePath();
            this.context.fill();
            this.hasDrawnDot = true;
        } else if (this.settingAlphaId === ALPHA_SQUARE) {
            if (angle !== undefined) {
                this.context.save();
                this.context.translate(x, y);
                this.context.rotate((angle / 180) * Math.PI);
                this.context.fillRect(-size, -size, size * 2, size * 2);
                this.context.restore();
                this.hasDrawnDot = true;
            }
        } else {
            // other brush alphas
            this.context.save();
            this.context.translate(x, y);
            let targetMipmap = this.alphaCanvas128;
            if (size <= 32 && size > 16) {
                targetMipmap = this.alphaCanvas64;
            } else if (size <= 16) {
                targetMipmap = this.alphaCanvas32;
            }
            this.context.scale(size, size);
            if (this.settingAlphaId === ALPHA_CHALK) {
                this.context.rotate(((x + y) * 53123) % TWO_PI); // without mod it sometimes looks different
            }
            this.context.drawImage(targetMipmap, -1, -1, 2, 2);

            this.context.restore();
            this.hasDrawnDot = true;
        }
    }

    // continueLine
    private continueLine(x: number | null, y: number | null, size: number, pressure: number): void {
        if (this.bezierLine === null) {
            this.bezierLine = new BB.BezierLine();
            this.bezierLine.add(this.lastInput.x, this.lastInput.y, 0, () => {});
        }

        const drawArr: [number, number, number, number, number, number | undefined][] = []; //draw instructions. will be all drawn at once

        const dotCallback = (val: {
            x: number;
            y: number;
            t: number;
            angle?: number;
            dAngle: number;
        }): void => {
            const localPressure = BB.mix(this.lastInput2.pressure, pressure, val.t);
            const localOpacity = this.calcOpacity(localPressure);
            const localSize = Math.max(
                0.1,
                this.settingSize * (this.settingHasSizePressure ? localPressure : 1),
            );
            const localScatter = this.calcScatter(localPressure);
            drawArr.push([val.x, val.y, localSize, localOpacity, localScatter, val.angle]);
        };

        const localSpacing = size * this.settingSpacing;
        if (x === null || y === null) {
            this.bezierLine.addFinal(localSpacing, dotCallback);
        } else {
            this.bezierLine.add(x, y, localSpacing, dotCallback);
        }

        // execute draw instructions
        this.context.save();
        let before: (typeof drawArr)[number] | undefined = undefined;
        for (let i = 0; i < drawArr.length; i++) {
            const item = drawArr[i];
            this.drawDot(item[0], item[1], item[2], item[3], item[4], item[5], before);
            before = item;
        }
        this.context.restore();
    }

    // ----------------------------------- public -----------------------------------
    constructor() {}

    // ---- interface ----

    startLine(x: number, y: number, p: number): void {
        this.changedTiles = [];
        p = BB.clamp(p, 0, 1);
        const localOpacity = this.calcOpacity(p);
        const localSize = this.settingHasSizePressure
            ? Math.max(0.1, p * this.settingSize)
            : Math.max(0.1, this.settingSize);
        const localScatter = this.calcScatter(p);

        this.hasDrawnDot = false;

        this.inputIsDrawing = true;
        this.context.save();
        this.drawDot(x, y, localSize, localOpacity, localScatter);
        this.context.restore();

        this.lineToolLastDot = localSize * this.settingSpacing;
        this.lastInput.x = x;
        this.lastInput.y = y;
        this.lastInput.pressure = p;
        this.lastInput2.pressure = p;

        this.inputArr = [
            {
                x,
                y,
                pressure: p,
            },
        ];
    }

    goLine(x: number, y: number, p: number): void {
        if (!this.inputIsDrawing) {
            return;
        }

        const pressure = BB.clamp(p, 0, 1);
        const localSize = this.settingHasSizePressure
            ? Math.max(0.1, this.lastInput.pressure * this.settingSize)
            : Math.max(0.1, this.settingSize);

        this.context.save();
        this.continueLine(x, y, localSize, this.lastInput.pressure);

        /*context.fillStyle = 'red';
        context.fillRect(Math.floor(x), Math.floor(y - 10), 1, 20);
        context.fillRect(Math.floor(x - 10), Math.floor(y), 20, 1);*/

        this.context.restore();

        this.lastInput.x = x;
        this.lastInput.y = y;
        this.lastInput2.pressure = this.lastInput.pressure;
        this.lastInput.pressure = pressure;

        this.inputArr.push({
            x,
            y,
            pressure: p,
        });
    }

    endLine(): void {
        const localSize = this.settingHasSizePressure
            ? Math.max(0.1, this.lastInput.pressure * this.settingSize)
            : Math.max(0.1, this.settingSize);
        this.context.save();
        this.continueLine(null, null, localSize, this.lastInput.pressure);
        this.context.restore();

        this.inputIsDrawing = false;

        if (this.settingAlphaId === ALPHA_SQUARE && !this.hasDrawnDot) {
            // find max pressure input, use that one
            let maxInput = this.inputArr[0];
            this.inputArr.forEach((item) => {
                if (item.pressure > maxInput.pressure) {
                    maxInput = item;
                }
            });

            this.context.save();
            const p = BB.clamp(maxInput.pressure, 0, 1);
            const localOpacity = this.calcOpacity(p);
            const localScatter = this.calcScatter(p);
            this.drawDot(maxInput.x, maxInput.y, localSize, localOpacity, localScatter, 0);
            this.context.restore();
        }

        this.bezierLine = null;

        this.klHistory.push(
            getPushableLayerChange(
                this.klHistory.getComposed(),
                canvasAndChangedTilesToLayerTiles(this.context.canvas, this.changedTiles),
            ),
        );

        this.hasDrawnDot = false;
        this.inputArr = [];
    }

    drawLineSegment(x1: number, y1: number, x2: number, y2: number): void {
        this.changedTiles = [];
        this.lastInput.x = x2;
        this.lastInput.y = y2;
        this.lastInput.pressure = 1;

        if (this.inputIsDrawing || x1 === undefined) {
            return;
        }

        const angle = BB.pointsToAngleDeg({ x: x1, y: y1 }, { x: x2, y: y2 });
        const mouseDist = Math.sqrt(Math.pow(x2 - x1, 2.0) + Math.pow(y2 - y1, 2.0));
        const eX = (x2 - x1) / mouseDist;
        const eY = (y2 - y1) / mouseDist;
        let loopDist;
        const bdist = this.settingSize * this.settingSpacing;
        this.lineToolLastDot = this.settingSize * this.settingSpacing;
        this.context.save();
        const localScatter = this.calcScatter(1);
        for (loopDist = this.lineToolLastDot; loopDist <= mouseDist; loopDist += bdist) {
            this.drawDot(
                x1 + eX * loopDist,
                y1 + eY * loopDist,
                this.settingSize,
                this.settingOpacity,
                localScatter,
                angle,
            );
        }
        this.context.restore();

        this.klHistory.push(
            getPushableLayerChange(
                this.klHistory.getComposed(),
                canvasAndChangedTilesToLayerTiles(this.context.canvas, this.changedTiles),
            ),
        );
    }

    //IS
    isDrawing(): boolean {
        return this.inputIsDrawing;
    }

    //SET
    setAlpha(a: number): void {
        if (this.settingAlphaId === a) {
            return;
        }
        this.settingAlphaId = a;
        this.updateAlphaCanvas();
    }

    setColor(c: IRGB): void {
        if (this.settingColor === c) {
            return;
        }
        this.settingColor = { r: c.r, g: c.g, b: c.b };
        this.settingColorStr =
            'rgb(' +
            this.settingColor.r +
            ',' +
            this.settingColor.g +
            ',' +
            this.settingColor.b +
            ')';
        this.updateAlphaCanvas();
    }

    setContext(c: CanvasRenderingContext2D): void {
        this.context = c;
    }

    setHistory(klHistory: KlHistory): void {
        this.klHistory = klHistory;
    }

    setSize(s: number): void {
        this.settingSize = s;
    }

    setOpacity(o: number): void {
        this.settingOpacity = o;
    }

    setScatter(o: number): void {
        this.settingScatter = o;
    }

    setSpacing(s: number): void {
        this.settingSpacing = s;
    }

    sizePressure(b: boolean): void {
        this.settingHasSizePressure = b;
    }

    opacityPressure(b: boolean): void {
        this.settingHasOpacityPressure = b;
    }

    scatterPressure(b: boolean): void {
        this.settingHasScatterPressure = b;
    }

    setLockAlpha(b: boolean): void {
        this.settingLockLayerAlpha = b;
    }

    //GET
    getSpacing(): number {
        return this.settingSpacing;
    }

    getSize(): number {
        return this.settingSize;
    }

    getOpacity(): number {
        return this.settingOpacity;
    }

    getScatter(): number {
        return this.settingScatter;
    }

    getLockAlpha(): boolean {
        return this.settingLockLayerAlpha;
    }
}
