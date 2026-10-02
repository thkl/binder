import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ResizableSplitComponent } from './resizable-split.component';

@Component({
  standalone: true,
  imports: [ResizableSplitComponent],
  template: `
    <resizable-split
      id="test-split"
      [initialFirstSize]="200"
      [firstMinSize]="100"
      [firstMaxSize]="300"
      [secondMinSize]="120"
    >
      <div splitPaneFirst>First</div>
      <div splitPaneSecond>Second</div>
    </resizable-split>
  `,
})
class TestHostComponent {}

@Component({
  standalone: true,
  imports: [ResizableSplitComponent],
  template: `
    <resizable-split
      id="percent-split"
      sizeUnit="percent"
      [initialFirstSize]="40"
      [firstMinSize]="20"
      [firstMaxSize]="80"
      [secondMinSize]="10"
    >
      <div splitPaneFirst>First</div>
      <div splitPaneSecond>Second</div>
    </resizable-split>
  `,
})
class PercentTestHostComponent {}

@Component({
  standalone: true,
  imports: [ResizableSplitComponent],
  template: `
    <resizable-split
      id="height-split"
      [heightResizable]="true"
      [initialHeight]="320"
      [minHeight]="260"
      [maxHeight]="420"
      (heightChange)="heightChanges.push($event)"
    >
      <div splitPaneFirst>First</div>
      <div splitPaneSecond>Second</div>
    </resizable-split>
  `,
})
class HeightTestHostComponent {
  readonly heightChanges: number[] = [];
}

function createPointerEvent(
  type: string,
  coordinates: { clientX?: number; clientY?: number } = {},
): Event {
  const { clientX = 0, clientY = 0 } = coordinates;

  if (typeof PointerEvent !== 'undefined') {
    return new PointerEvent(type, {
      bubbles: true,
      clientX,
      clientY,
      pointerId: 1,
    });
  }

  const event = new MouseEvent(type, {
    bubbles: true,
    clientX,
    clientY,
  });

  Object.defineProperty(event, 'pointerId', { value: 1 });
  return event;
}

describe('ResizableSplitComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let getBoundingClientRectSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    localStorage.clear();
    getBoundingClientRectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({
        x: 0,
        y: 0,
        width: 500,
        height: 300,
        top: 0,
        right: 500,
        bottom: 300,
        left: 0,
        toJSON: () => ({}),
      });

    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    getBoundingClientRectSpy.mockRestore();
  });

  it('uses the configured initial first pane size', () => {
    const split = fixture.debugElement.children[0].componentInstance as ResizableSplitComponent;

    expect(split.firstSize()).toBe(200);
  });

  it('persists the resized first pane size in local storage', () => {
    const divider = fixture.nativeElement.querySelector(
      '.resizable-split__divider',
    ) as HTMLButtonElement;

    divider.dispatchEvent(createPointerEvent('pointerdown', { clientX: 200 }));
    document.dispatchEvent(createPointerEvent('pointermove', { clientX: 250 }));
    document.dispatchEvent(createPointerEvent('pointerup', { clientX: 250 }));
    fixture.detectChanges();

    expect(localStorage.getItem('resizable-split:test-split')).toBe('px:250');
  });

  it('clamps dragging to the configured pane limits', () => {
    const divider = fixture.nativeElement.querySelector(
      '.resizable-split__divider',
    ) as HTMLButtonElement;
    const split = fixture.debugElement.children[0].componentInstance as ResizableSplitComponent;

    divider.dispatchEvent(createPointerEvent('pointerdown', { clientX: 200 }));
    document.dispatchEvent(createPointerEvent('pointermove', { clientX: 1000 }));
    document.dispatchEvent(createPointerEvent('pointerup', { clientX: 1000 }));
    fixture.detectChanges();

    expect(split.firstSize()).toBe(300);
  });

  it('supports percent sizes', () => {
    const percentFixture = TestBed.createComponent(PercentTestHostComponent);
    percentFixture.detectChanges();
    const divider = percentFixture.nativeElement.querySelector(
      '.resizable-split__divider',
    ) as HTMLButtonElement;
    const split = percentFixture.debugElement.children[0]
      .componentInstance as ResizableSplitComponent;

    divider.dispatchEvent(createPointerEvent('pointerdown', { clientX: 200 }));
    document.dispatchEvent(createPointerEvent('pointermove', { clientX: 249.4 }));
    document.dispatchEvent(createPointerEvent('pointerup', { clientX: 249.4 }));
    percentFixture.detectChanges();

    expect(split.firstSize()).toBe(50);
    expect(localStorage.getItem('resizable-split:percent-split')).toBe('percent:50');
  });

  it('persists the resized split view height in local storage', () => {
    const heightFixture = TestBed.createComponent(HeightTestHostComponent);
    heightFixture.detectChanges();
    const heightDivider = heightFixture.nativeElement.querySelector(
      '.resizable-split__height-divider',
    ) as HTMLButtonElement;
    const split = heightFixture.debugElement.children[0]
      .componentInstance as ResizableSplitComponent;

    heightDivider.dispatchEvent(createPointerEvent('pointerdown', { clientY: 320 }));
    document.dispatchEvent(createPointerEvent('pointermove', { clientY: 380 }));
    document.dispatchEvent(createPointerEvent('pointerup', { clientY: 380 }));
    heightFixture.detectChanges();

    expect(split.height()).toBe(380);
    expect(heightFixture.componentInstance.heightChanges).toContain(380);
    expect(localStorage.getItem('resizable-split:height-split:height')).toBe('px:380');
  });

  it('restores the split view height from local storage', async () => {
    localStorage.setItem('resizable-split:height-split:height', 'px:390');
    const heightFixture = TestBed.createComponent(HeightTestHostComponent);
    heightFixture.detectChanges();
    await heightFixture.whenStable();
    heightFixture.detectChanges();
    const split = heightFixture.debugElement.children[0]
      .componentInstance as ResizableSplitComponent;

    expect(split.height()).toBe(390);
  });

  it('keeps a restored height as the saved value while allowing the host to fill taller parents', async () => {
    localStorage.setItem('resizable-split:height-split:height', 'px:390');
    const heightFixture = TestBed.createComponent(HeightTestHostComponent);
    heightFixture.detectChanges();
    await heightFixture.whenStable();
    heightFixture.detectChanges();
    const split = heightFixture.debugElement.children[0]
      .componentInstance as ResizableSplitComponent;
    const host = heightFixture.nativeElement.querySelector('resizable-split') as HTMLElement;

    expect(split.height()).toBe(390);
    expect(host.style.height).toBe('390px');
    expect(host.style.minHeight).toBe('100%');
    expect(localStorage.getItem('resizable-split:height-split:height')).toBe('px:390');
  });

  it('does not emit height changes while restoring a saved height', () => {
    localStorage.setItem('resizable-split:height-split:height', 'px:390');
    const heightFixture = TestBed.createComponent(HeightTestHostComponent);
    heightFixture.detectChanges();

    expect(heightFixture.componentInstance.heightChanges).toEqual([]);
  });
});
