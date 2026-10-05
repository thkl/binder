import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  EventEmitter,
  HostBinding,
  Output,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';

export type ResizableSplitOrientation = 'vertical' | 'horizontal';
export type ResizableSplitSizeUnit = 'px' | 'percent';

@Component({
  selector: 'resizable-split',
  standalone: true,
  templateUrl: './resizable-split.component.html',
  styleUrl: './resizable-split.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResizableSplitComponent {
  readonly id = input.required<string>();
  readonly orientation = input<ResizableSplitOrientation>('vertical');
  readonly sizeUnit = input<ResizableSplitSizeUnit>('px');
  readonly initialFirstSize = input<number | null>(null);
  readonly firstMinSize = input<number>(0);
  readonly firstMaxSize = input<number | null>(null);
  readonly secondMinSize = input<number>(0);
  readonly secondMaxSize = input<number | null>(null);
  readonly disabled = input<boolean>(false);
  readonly storagePrefix = input<string>('resizable-split');
  readonly heightResizable = input<boolean>(false);
  readonly initialHeight = input<number | null>(null);
  readonly minHeight = input<number>(240);
  readonly maxHeight = input<number | null>(null);

  @Output() readonly heightChange = new EventEmitter<number>();

  readonly firstSize = signal<number | null>(null);
  readonly height = signal<number | null>(null);
  readonly dragging = signal<boolean>(false);
  readonly heightDragging = signal<boolean>(false);

  private readonly container = viewChild<ElementRef<HTMLElement>>('container');
  private readonly destroyRef = inject(DestroyRef);
  private readonly dividerSize = 6;
  private dragStartCoordinate = 0;
  private dragStartFirstSize = 0;
  private heightDragStartCoordinate = 0;
  private heightDragStartHeight = 0;
  private previousBodyCursor = '';
  private activePointerId: number | null = null;
  private activePointerTarget: HTMLElement | null = null;
  private pendingFirstSize: number | null = null;
  private firstSizeFrame: number | null = null;
  private pendingHeight: number | null = null;
  private heightFrame: number | null = null;
  private viewReady = false;

  readonly isVertical = computed(() => this.orientation() === 'vertical');
  readonly hostHeight = computed(() =>
    this.heightResizable() ? `${this.resolvedHeight()}px` : '100%',
  );
  readonly hostMinHeight = computed(() => (this.heightResizable() ? '100%' : null));
  readonly ariaHeightValueNow = computed(() => Math.round(this.resolvedHeight()));
  readonly ariaHeightValueMin = computed(() => Math.round(this.heightRange().min));
  readonly ariaHeightValueMax = computed(() => Math.round(this.heightRange().max));

  @HostBinding('class.resizable-split-host--height-resizable')
  get heightResizeEnabled(): boolean {
    return this.heightResizable();
  }

  @HostBinding('class.resizable-split-host--height-dragging')
  get heightResizeDragging(): boolean {
    return this.heightDragging();
  }

  @HostBinding('style.height')
  get hostHeightStyle(): string {
    return this.hostHeight();
  }

  @HostBinding('style.min-height')
  get hostMinHeightStyle(): string | null {
    return this.hostMinHeight();
  }

  readonly gridTemplateColumns = computed(() => {
    if (!this.isVertical()) {
      return 'minmax(0, 1fr)';
    }

    return `${this.firstSizeCssValue()} ${this.dividerSize}px minmax(0, 1fr)`;
  });

  readonly gridTemplateRows = computed(() => {
    if (this.isVertical()) {
      return 'minmax(0, 1fr)';
    }

    return `var(--resizable-split-rows, ${this.firstSizeCssValue()} ${this.dividerSize}px minmax(0, 1fr))`;
  });

  readonly ariaOrientation = computed(() => (this.isVertical() ? 'vertical' : 'horizontal'));
  readonly ariaValueNow = computed(() => Math.round(this.resolvedFirstSize()));
  readonly ariaValueMin = computed(() => Math.round(this.sizeRange().min));
  readonly ariaValueMax = computed(() => Math.round(this.sizeRange().max));

  constructor() {
    effect(() => {
      this.id();
      this.orientation();
      this.sizeUnit();
      this.initialFirstSize();
      this.firstMinSize();
      this.firstMaxSize();
      this.secondMinSize();
      this.secondMaxSize();
      this.heightResizable();
      this.initialHeight();
      this.minHeight();
      this.maxHeight();

      if (!this.viewReady) {
        return;
      }

      this.restoreSize();
      this.restoreHeight();
    });

    afterNextRender(() => {
      this.viewReady = true;
      this.restoreSize();
      this.restoreHeight();
    });

    this.destroyRef.onDestroy(() => {
      this.stopDragging();
      this.stopHeightDragging();
    });
  }

  /** Starts pane resizing from the divider between the two split panes. */
  startDragging(event: PointerEvent): void {
    if (this.disabled()) {
      return;
    }

    event.preventDefault();
    this.capturePointer(event);
    this.dragStartCoordinate = this.pointerCoordinate(event);
    this.dragStartFirstSize = this.resolvedFirstSize();
    this.dragging.set(true);
    this.previousBodyCursor = document.body.style.cursor;
    document.body.style.cursor = this.isVertical() ? 'col-resize' : 'row-resize';

    document.addEventListener('pointermove', this.handlePointerMove);
    document.addEventListener('pointerup', this.handlePointerUp);
    document.addEventListener('pointercancel', this.handlePointerUp);
  }

  /** Handles keyboard resizing for the divider between the two split panes. */
  handleKeydown(event: KeyboardEvent): void {
    if (this.disabled()) {
      return;
    }

    const step = event.shiftKey ? 50 : 10;
    const current = this.resolvedFirstSize();

    switch (event.key) {
      case 'ArrowLeft':
        if (this.isVertical()) {
          event.preventDefault();
          this.setFirstSize(current - step, true);
        }
        return;
      case 'ArrowRight':
        if (this.isVertical()) {
          event.preventDefault();
          this.setFirstSize(current + step, true);
        }
        return;
      case 'ArrowUp':
        if (!this.isVertical()) {
          event.preventDefault();
          this.setFirstSize(current - step, true);
        }
        return;
      case 'ArrowDown':
        if (!this.isVertical()) {
          event.preventDefault();
          this.setFirstSize(current + step, true);
        }
        return;
      case 'Home':
        event.preventDefault();
        this.setFirstSize(this.sizeRange().min, true);
        return;
      case 'End':
        event.preventDefault();
        this.setFirstSize(this.sizeRange().max, true);
        return;
      default:
        return;
    }
  }

  /** Starts resizing the full split view height from the bottom divider. */
  startHeightDragging(event: PointerEvent): void {
    if (this.disabled() || !this.heightResizable()) {
      return;
    }

    event.preventDefault();
    this.capturePointer(event);
    this.heightDragStartCoordinate = event.clientY;
    this.heightDragStartHeight = this.resolvedHeight();
    this.heightDragging.set(true);
    this.previousBodyCursor = document.body.style.cursor;
    document.body.style.cursor = 'row-resize';

    document.addEventListener('pointermove', this.handleHeightPointerMove);
    document.addEventListener('pointerup', this.handleHeightPointerUp);
    document.addEventListener('pointercancel', this.handleHeightPointerUp);
  }

  /** Handles keyboard resizing for the full split view height. */
  handleHeightKeydown(event: KeyboardEvent): void {
    if (this.disabled() || !this.heightResizable()) {
      return;
    }

    const step = event.shiftKey ? 50 : 10;
    const current = this.resolvedHeight();

    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault();
        this.setHeight(current - step, true);
        return;
      case 'ArrowDown':
        event.preventDefault();
        this.setHeight(current + step, true);
        return;
      case 'Home':
        event.preventDefault();
        this.setHeight(this.heightRange().min, true);
        return;
      case 'End':
        event.preventDefault();
        this.setHeight(this.heightRange().max, true);
        return;
      default:
        return;
    }
  }

  /** Clears persisted split sizes and restores the configured defaults. */
  reset(): void {
    this.removeStoredSize();
    this.removeStoredHeight();
    this.restoreSize();
    this.restoreHeight();
  }

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (!this.dragging() || !this.isActivePointer(event)) {
      return;
    }

    const delta = this.pointerCoordinate(event) - this.dragStartCoordinate;
    this.scheduleFirstSize(this.dragStartFirstSize + this.toConfiguredUnit(delta));
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (!this.dragging() || !this.isActivePointer(event)) {
      return;
    }

    this.flushFirstSize();
    this.saveSize();
    this.stopDragging();
  };

  private readonly handleHeightPointerMove = (event: PointerEvent): void => {
    if (!this.heightDragging() || !this.isActivePointer(event)) {
      return;
    }

    const delta = event.clientY - this.heightDragStartCoordinate;
    this.scheduleHeight(this.heightDragStartHeight + delta);
  };

  private readonly handleHeightPointerUp = (event: PointerEvent): void => {
    if (!this.heightDragging() || !this.isActivePointer(event)) {
      return;
    }

    this.flushHeight();
    this.saveHeight();
    this.stopHeightDragging();
  };

  private stopDragging(): void {
    this.cancelFirstSizeFrame();
    this.pendingFirstSize = null;
    this.releasePointer();

    if (this.dragging()) {
      this.dragging.set(false);
      document.body.style.cursor = this.previousBodyCursor;
    }

    document.removeEventListener('pointermove', this.handlePointerMove);
    document.removeEventListener('pointerup', this.handlePointerUp);
    document.removeEventListener('pointercancel', this.handlePointerUp);
  }

  private stopHeightDragging(): void {
    this.cancelHeightFrame();
    this.pendingHeight = null;
    this.releasePointer();

    if (this.heightDragging()) {
      this.heightDragging.set(false);
      document.body.style.cursor = this.previousBodyCursor;
    }

    document.removeEventListener('pointermove', this.handleHeightPointerMove);
    document.removeEventListener('pointerup', this.handleHeightPointerUp);
    document.removeEventListener('pointercancel', this.handleHeightPointerUp);
  }

  private capturePointer(event: PointerEvent): void {
    const target = event.currentTarget;

    this.activePointerId = event.pointerId;
    this.activePointerTarget = target instanceof HTMLElement ? target : null;

    if (
      this.activePointerTarget &&
      typeof this.activePointerTarget.setPointerCapture === 'function'
    ) {
      this.activePointerTarget.setPointerCapture(event.pointerId);
    }
  }

  private releasePointer(): void {
    if (
      this.activePointerTarget &&
      this.activePointerId !== null &&
      typeof this.activePointerTarget.hasPointerCapture === 'function' &&
      this.activePointerTarget.hasPointerCapture(this.activePointerId)
    ) {
      this.activePointerTarget.releasePointerCapture(this.activePointerId);
    }

    this.activePointerId = null;
    this.activePointerTarget = null;
  }

  private isActivePointer(event: PointerEvent): boolean {
    return this.activePointerId === null || event.pointerId === this.activePointerId;
  }

  private scheduleFirstSize(size: number): void {
    this.pendingFirstSize = size;

    if (typeof window.requestAnimationFrame !== 'function') {
      this.flushFirstSize();
      return;
    }

    if (this.firstSizeFrame !== null) {
      return;
    }

    this.firstSizeFrame = window.requestAnimationFrame(() => {
      this.firstSizeFrame = null;
      this.flushFirstSize();
    });
  }

  private flushFirstSize(): void {
    this.cancelFirstSizeFrame();

    const size = this.pendingFirstSize;
    this.pendingFirstSize = null;

    if (size !== null && this.dragging()) {
      this.setFirstSize(size, false);
    }
  }

  private cancelFirstSizeFrame(): void {
    if (this.firstSizeFrame === null) {
      return;
    }

    if (typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(this.firstSizeFrame);
    }

    this.firstSizeFrame = null;
  }

  private scheduleHeight(height: number): void {
    this.pendingHeight = height;

    if (typeof window.requestAnimationFrame !== 'function') {
      this.flushHeight();
      return;
    }

    if (this.heightFrame !== null) {
      return;
    }

    this.heightFrame = window.requestAnimationFrame(() => {
      this.heightFrame = null;
      this.flushHeight();
    });
  }

  private flushHeight(): void {
    this.cancelHeightFrame();

    const height = this.pendingHeight;
    this.pendingHeight = null;

    if (height !== null && this.heightDragging()) {
      this.setHeight(height, false);
    }
  }

  private cancelHeightFrame(): void {
    if (this.heightFrame === null) {
      return;
    }

    if (typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(this.heightFrame);
    }

    this.heightFrame = null;
  }

  private restoreSize(): void {
    const storedSize = this.readStoredSize();
    const initialSize = this.initialFirstSize();
    const defaultSize = this.sizeUnit() === 'percent' ? 50 : this.containerSize() / 2;
    const preferredSize = storedSize ?? initialSize ?? defaultSize;

    this.setFirstSize(preferredSize, false);
  }

  private restoreHeight(): void {
    if (!this.heightResizable()) {
      return;
    }

    const storedHeight = this.readStoredHeight();
    const initialHeight = this.initialHeight();
    const defaultHeight = this.measuredHostHeight();
    const preferredHeight = storedHeight ?? initialHeight ?? defaultHeight;

    this.setHeight(preferredHeight, false, false);
  }

  private resolvedFirstSize(): number {
    const currentSize = this.firstSize();

    if (currentSize !== null) {
      return currentSize;
    }

    const initialSize = this.initialFirstSize();

    if (initialSize !== null) {
      return initialSize;
    }

    if (this.sizeUnit() === 'percent') {
      return 50;
    }

    return this.containerSize() / 2;
  }

  private resolvedHeight(): number {
    const currentHeight = this.height();

    if (currentHeight !== null) {
      return currentHeight;
    }

    const initialHeight = this.initialHeight();

    if (initialHeight !== null) {
      return initialHeight;
    }

    return this.measuredHostHeight();
  }

  private setFirstSize(size: number, save: boolean): void {
    const range = this.sizeRange();
    const clampedSize = Math.min(Math.max(size, range.min), range.max);

    this.firstSize.set(clampedSize);

    if (save) {
      this.saveSize();
    }
  }

  private setHeight(height: number, save: boolean, emit: boolean = true): void {
    const range = this.heightRange();
    const clampedHeight = Math.min(Math.max(height, range.min), range.max);

    this.height.set(clampedHeight);

    if (emit) {
      this.heightChange.emit(clampedHeight);
    }

    if (save) {
      this.saveHeight();
    }
  }

  private firstSizeCssValue(): string {
    if (this.sizeUnit() === 'percent') {
      return `calc((100% - ${this.dividerSize}px) * ${this.resolvedFirstSize() / 100})`;
    }

    return `${this.resolvedFirstSize()}px`;
  }

  private sizeRange(): { min: number; max: number } {
    const totalSize = this.sizeUnit() === 'percent' ? 100 : this.containerSize();
    const minByFirst = Math.max(0, this.firstMinSize());
    const minBySecondMax = this.maxInput(this.secondMaxSize());
    const maxByFirst = this.maxInput(this.firstMaxSize());
    const maxBySecondMin = Math.max(0, totalSize - Math.max(0, this.secondMinSize()));
    const min = Math.max(minByFirst, totalSize - minBySecondMax);
    const max = Math.min(maxByFirst, maxBySecondMin);

    if (max < min) {
      return { min, max: min };
    }

    return { min, max };
  }

  private heightRange(): { min: number; max: number } {
    const min = Math.max(0, this.minHeight());
    const max = this.maxInput(this.maxHeight());

    if (max < min) {
      return { min, max: min };
    }

    return { min, max };
  }

  private containerSize(): number {
    const element = this.container()?.nativeElement;

    if (!element) {
      return 0;
    }

    const rect = element.getBoundingClientRect();
    const size = this.isVertical() ? rect.width : rect.height;

    return Math.max(0, size - this.dividerSize);
  }

  private measuredHostHeight(): number {
    const element = this.container()?.nativeElement.parentElement;
    const fallbackHeight = this.minHeight();

    if (!element) {
      return fallbackHeight;
    }

    const height = element.getBoundingClientRect().height;

    if (height <= 0) {
      return fallbackHeight;
    }

    return height;
  }

  private pointerCoordinate(event: PointerEvent): number {
    return this.isVertical() ? event.clientX : event.clientY;
  }

  private toConfiguredUnit(pixelDelta: number): number {
    if (this.sizeUnit() === 'px') {
      return pixelDelta;
    }

    const containerSize = this.containerSize();

    if (containerSize <= 0) {
      return 0;
    }

    return (pixelDelta / containerSize) * 100;
  }

  private storageKey(): string {
    return `${this.storagePrefix()}:${this.id()}`;
  }

  private heightStorageKey(): string {
    return `${this.storageKey()}:height`;
  }

  private readStoredSize(): number | null {
    try {
      const storedValue = localStorage.getItem(this.storageKey());

      if (storedValue === null) {
        return null;
      }

      const storedSize = this.parseStoredSize(storedValue);

      if (!Number.isFinite(storedSize)) {
        return null;
      }

      return storedSize;
    } catch {
      return null;
    }
  }

  private readStoredHeight(): number | null {
    try {
      const storedValue = localStorage.getItem(this.heightStorageKey());

      if (storedValue === null) {
        return null;
      }

      const storedHeight = this.parseStoredPixelSize(storedValue);

      if (!Number.isFinite(storedHeight)) {
        return null;
      }

      return storedHeight;
    } catch {
      return null;
    }
  }

  private saveSize(): void {
    try {
      localStorage.setItem(this.storageKey(), `${this.sizeUnit()}:${this.resolvedFirstSize()}`);
    } catch {
      return;
    }
  }

  private saveHeight(): void {
    try {
      localStorage.setItem(this.heightStorageKey(), `px:${this.resolvedHeight()}`);
    } catch {
      return;
    }
  }

  private removeStoredSize(): void {
    try {
      localStorage.removeItem(this.storageKey());
    } catch {
      return;
    }
  }

  private removeStoredHeight(): void {
    try {
      localStorage.removeItem(this.heightStorageKey());
    } catch {
      return;
    }
  }

  private maxInput(value: number | null): number {
    if (value === null) {
      return Number.POSITIVE_INFINITY;
    }

    return Math.max(0, value);
  }

  private parseStoredSize(storedValue: string): number {
    const [storedUnit, storedSize] = storedValue.split(':');

    if (storedSize === undefined) {
      return this.sizeUnit() === 'px' ? Number(storedValue) : Number.NaN;
    }

    if (storedUnit !== this.sizeUnit()) {
      return Number.NaN;
    }

    return Number(storedSize);
  }

  private parseStoredPixelSize(storedValue: string): number {
    const [storedUnit, storedSize] = storedValue.split(':');

    if (storedSize === undefined) {
      return Number(storedValue);
    }

    if (storedUnit !== 'px') {
      return Number.NaN;
    }

    return Number(storedSize);
  }
}
