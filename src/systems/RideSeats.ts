import type {PlayerSnapshot} from './RoomProtocol';
export interface RideSeat {playerId:string;driverId:string;vehicleId:number;seat:number}
export interface RoomPlayer {id:string;state:PlayerSnapshot}
/** Only the room host assigns seats; clients cannot claim another player's seat. */
export class RideSeats {
 readonly seats=new Map<string,RideSeat>();
 request(playerId:string,driverId:string,players:RoomPlayer[]):string|null {
  const passenger=players.find(p=>p.id===playerId)?.state,driver=players.find(p=>p.id===driverId)?.state;
  if(!passenger||!driver?.vehicle||playerId===driverId||passenger.vehicle||this.seats.has(driverId))return 'This car is no longer available.';
  if(this.seats.has(playerId))return 'Leave your current seat first.';
  if(driver.vehicle.flying||driver.speed>2||Math.abs(passenger.y-driver.y)>2.5||Math.hypot(passenger.x-driver.x,passenger.z-driver.z)>5)return 'Ask the driver to stop and land beside you.';
  const kind=driver.vehicle.kind??'car';
  if(kind==='bicycle')return 'Bicycles only fit one rider.';
  const used=[...this.seats.values()].filter(s=>s.driverId===driverId);
  const seat=[1,2,3].slice(0,passengerSeats(kind)).find(n=>!used.some(s=>s.seat===n));
  if(!seat)return kind==='motorbike'?'This motorbike already has a passenger.':'This car is full (three passenger seats).';
  this.seats.set(playerId,{playerId,driverId,vehicleId:driver.vehicle.id??0,seat});return null;
 }
 reconcile(players:RoomPlayer[]):void {
  for(const [id,s] of this.seats){const driver=players.find(p=>p.id===s.driverId)?.state;
   if(!players.some(p=>p.id===id)||!driver?.vehicle||(driver.vehicle.id??0)!==s.vehicleId)this.seats.delete(id);
  }
 }
}
/** Passenger seats per vehicle: three in a car, one on the back of a motorbike. */
export function passengerSeats(kind:'car'|'motorbike'|'bicycle'):number{return kind==='car'?3:kind==='motorbike'?1:0}
export function validRideSeats(raw:unknown):raw is RideSeat[] {
 return Array.isArray(raw)&&raw.length<=7&&raw.every(s=>s&&typeof s.playerId==='string'&&s.playerId.length<100&&typeof s.driverId==='string'&&s.driverId.length<100&&s.playerId!==s.driverId&&Number.isSafeInteger(s.vehicleId)&&s.vehicleId>=0&&[1,2,3].includes(s.seat))&&new Set(raw.map(s=>s.playerId)).size===raw.length&&new Set(raw.map(s=>s.driverId+':'+s.seat)).size===raw.length;
}
