/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Logger } from '@nestjs/common';

import * as util from 'node:util';

export interface LoggingContext {
  moduleName: string;
  user: string;
}

export function createContext(moduleName: string): LoggingContext {
  const strUser = 'service';

  const context: LoggingContext = {
    moduleName,
    user: strUser,
  };
  return context;
}

export class BinderLogger {
  protected readonly logger;
  protected readonly name: string;

  constructor(name: string) {
    this.name = name;
    this.logger = new Logger(name);
  }

  prepareLog(message: any, ...optionalParams: any): { output: any } {
    const fmParam = [message];
    let ptp = optionalParams;

    if (Array.isArray(optionalParams)) {
      ptp = optionalParams[0]; //weird ..
    }

    if (Array.isArray(ptp)) {
      ptp.forEach((param) => {
        if (param !== null && param instanceof Error) {
          fmParam.push(JSON.stringify(param));
        }

        if (param !== null && typeof param === 'object') {
          // lame function to detect if the object is a user
          try {
            fmParam.push(JSON.stringify(param));
          } catch (e) {
            console.error(e);
          }
        } else {
          fmParam.push(param);
        }
      });
    }

    // this apply is a little bit strange .. util.format wants message,par,par2,par3
    // we have an array of parameters so we have to go back to the old js days
    const result = {
      // eslint-disable-next-line prefer-spread
      output: fmParam.length > 1 ? util.format.apply(util, fmParam) : message,
    };
    return result;
  }

  /* just some conviniance functions to format the stuff */
  log(message: any, ...optionalParams: [...any, string?, string?]): void {
    try {
      const { output } = this.prepareLog(message, optionalParams);
      this.logit(output);
    } catch (e) {
      console.error(e);
    }
  }

  debug(message: any, ...optionalParams: [...any, string?, string?]): void {
    try {
      const { output } = this.prepareLog(message, optionalParams);
      this.debugit(output);
    } catch (e) {
      console.error(e);
    }
  }

  warn(message: any, ...optionalParams: [...any, string?, string?]): void {
    try {
      const { output } = this.prepareLog(message, optionalParams);
      this.warnit(output);
    } catch (e) {
      console.error(e);
    }
  }

  error(message: any, ...optionalParams: [...any, string?, string?]): void {
    try {
      const { output } = this.prepareLog(message, optionalParams);
      this.errorit(output);
    } catch (e) {
      console.error(e);
    }
  }

  info(message: any, ...optionalParams: [...any, string?, string?]): void {
    try {
      const { output } = this.prepareLog(message, optionalParams);
      this.infoit(output);
    } catch (e) {
      console.error(e);
    }
  }

  logit(message: any): void {
    this.logger.log(message, createContext(this.name));
  }

  infoit(message: any): void {
    this.logger.log(message, createContext(this.name));
  }

  warnit(message: any): void {
    this.logger.warn(message, createContext(this.name));
  }

  errorit(message: any): void {
    if (message instanceof Error) {
      this.logger.error(`${message.message} at ${message.stack}`, createContext(this.name));
    } else {
      this.logger.error(message, createContext(this.name));
    }
  }

  debugit(message: any): void {
    this.logger.debug(message, createContext(this.name));
  }
}
