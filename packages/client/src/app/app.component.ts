import { ChangeDetectionStrategy, Component, signal } from '@angular/core';

@Component({
  selector: 'binder-root',
  standalone: true,
  template: `
    <main>
      <h1>Binder</h1>
      @if (ready()) {
        <p>Document management workspace ready.</p>
      }
      @for (item of nextSteps; track item) {
        <li>{{ item }}</li>
      }
    </main>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AppComponent {
  readonly ready = signal(true);
  readonly nextSteps = ['Define the first document contract', 'Connect the API health endpoint'];
}
