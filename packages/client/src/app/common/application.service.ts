import { Injectable } from "@angular/core";
import { environment } from "../../environments/environment";

@Injectable({ providedIn: 'root' })
export class ApplicationService {


    getApiUrl(version:string,endpoint:string,optional?:string):string {
        const result = `${environment.apiUrl}/${version}/${endpoint}`;
        return (optional) ? `${result}${optional}` : result
    }
}