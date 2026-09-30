/**
 * This class will provice static helpers for accessing object properties
 * it will try its best to prevent you from leaking data or inject data
 */
export class SafePropertyAccess {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  private static DANGEROUS_KEYS = new Set([
    '__proto__',
    'constructor',
    'prototype',
    '__defineGetter__',
    '__defineSetter__',
    '__lookupGetter__',
    '__lookupSetter__',
  ]);

  static isValidKey(key: string): boolean {
    return typeof key === 'string' && key.length > 0 && !this.DANGEROUS_KEYS.has(key);
  }

  /**
   * this is a save way for result = obj[key]
   * the helper will check if the key is valid
   * and reject it if its a possible prototype pollution
   * like constructor or __proto__ so no
   * injection
   * @param obj the object to read data
   * @param key the name of the field
   * @returns the data or undefined if access violation or the object has no such key
   */
  static get<T>(obj: any, key: string): T | undefined {
    if (!obj) {
      return undefined;
    }
    if (!this.isValidKey(key) || !Object.prototype.hasOwnProperty.call(obj, key)) {
      return undefined;
    }
    return Reflect.get(obj, key);
  }

  /**
   * This is a safe way to run obj[key]=value
   * the helper will check if the key is valid
   * and reject it if its a possible prototype pollution
   * @param obj the object
   * @param key the name of the property from the object
   * @param value the value to set
   * @returns true if it was possible to set
   */
  static set(obj: any, key: string, value: any): boolean {
    if (!obj) {
      obj = {}; // initialize the object
    }
    if (!this.isValidKey(key)) {
      return false;
    }
    return Reflect.set(obj, key, value);
  }

  static has(obj: any, key: string): boolean {
    if (!this.isValidKey(key)) {
      return false;
    }
    return Reflect.has(obj, key) && Object.prototype.hasOwnProperty.call(obj, key);
  }

  /**
   * this will try to delete a property with the key from the object
   * the function will try its best to not pollute the prototype by rejecting keys like constructor
   * @param obj the object
   * @param key the key
   * @returns false if there was an error
   */
  static delete(obj: any, key: string): boolean {
    if (!this.isValidKey(key)) {
      return false;
    }
    return Reflect.deleteProperty(obj, key);
  }
}
