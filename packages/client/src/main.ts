import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { AppComponent } from './app/app.component';
import { appRoutes } from './app/app.routes';
import { csrfInterceptor } from './app/common/security/csrf.interceptor';

bootstrapApplication(AppComponent, { providers: [provideHttpClient(withInterceptors([csrfInterceptor])), provideRouter(appRoutes)] })
  .catch((error: unknown) => console.error(error));
