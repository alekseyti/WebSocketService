import { Injectable } from '@angular/core';
import { Subject, BehaviorSubject, timer, of, race, Subscription } from 'rxjs'
import { filter,shareReplay, tap, catchError, concatMap, retryWhen, delay } from 'rxjs/operators'
import { WebSocketSubject, WebSocketSubjectConfig, webSocket } from "rxjs/webSocket"
import { StorageService } from 'app/services/storage.service'


@Injectable({
  providedIn: 'root'
})
export class WebSocketService {

  private webSocketSubject: WebSocketSubject<any> | null = null;
  private heartbeatSubscription: Subscription | null = null;

  networkErrorSubject = new BehaviorSubject(false)
  data = new BehaviorSubject<any>([])
  _data = []


  constructor(
    private storageService: StorageService,
  ) { }

  connect(): WebSocketSubject<any> {
    if (!this.webSocketSubject) {
      const closeSubject = new Subject<CloseEvent>();
      closeSubject.subscribe(() => {
        this.webSocketSubject = null
      })

      this.webSocketSubject = webSocket({
        url: 'ws://localhost:8080',
        protocol: ["access_token", this.storageService.getFromStorage('access_token')],
        deserializer: ({ data }) => JSON.parse(data),
        closeObserver: closeSubject,
        openObserver: {
          next: () => console.log('connection open')
        }
      });

      this.webSocketSubject.pipe(retryWhen((errors) => errors.pipe(
        tap(err => {
          this.stopHeartbeat()
          this.networkErrorSubject.next(true)
          this.webSocketSubject?.complete()
          this.webSocketSubject = null
          this._data = []
          this.data = new BehaviorSubject<any>([])

        }),
        delay(10_000),
        shareReplay()
      )))
        .subscribe(value => {
          this.networkErrorSubject.next(false)


        })

      this.startHeartbeat();
    }
    return this.webSocketSubject;
  }

  startHeartbeat(): void {
    this.stopHeartbeat();
    const heartbeat$ = timer(10_000, 30_000)
      .pipe(
        tap(() => this.connect().next('ping')),
        concatMap(() => {
          return race(
            of('timeout').pipe(delay(5_000)),
            this.connect().pipe(filter(m => m === 'pong'), catchError(() => of('error')))
          );
        })
      );

    this.heartbeatSubscription = heartbeat$.subscribe(msg => {
      if (msg === 'pong') {
        this.networkErrorSubject.next(false)
      } else {
        this.networkErrorSubject.next(true)
        this.webSocketSubject?.complete()
        this.webSocketSubject = null
        this._data = []
        this.data = new BehaviorSubject<any>([])
      }
    });
  }

  stopHeartbeat(): void {
    if (this.heartbeatSubscription) {
      this.heartbeatSubscription.unsubscribe()
    }
  }

  disconnect(): void {
    console.log('connection close')
    if (this.webSocketSubject) {
      this.stopHeartbeat()
      this.webSocketSubject.complete()
      this.webSocketSubject = null
      this._data = []
      this.data = new BehaviorSubject<any>([])
    }
  }

}
