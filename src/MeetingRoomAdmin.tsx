import React, { useEffect, useState } from 'react';
import { Building2, CheckCircle, Loader2, RefreshCw, Save, Trash2 } from 'lucide-react';
import { authFetch } from './authFetch';

type MeetingRoom = {
  id: string;
  name: string;
  location?: string;
  capacity?: string;
  isActive: boolean;
  sortOrder?: number;
  openTime?: string;
  closeTime?: string;
  createdAt?: string;
};

type MeetingBooking = {
  id: string;
  roomName: string;
  bookerEmail: string;
  bookerName: string;
  department: string;
  date: string;
  startTime: string;
  endTime: string;
  purpose: string;
};

function todayText() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysText(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export default function MeetingRoomAdmin() {
  const [rooms, setRooms] = useState<MeetingRoom[]>([]);
  const [bookings, setBookings] = useState<MeetingBooking[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [startDate, setStartDate] = useState(todayText());
  const [endDate, setEndDate] = useState(addDaysText(30));
  const [roomForm, setRoomForm] = useState<MeetingRoom>({
    id: '',
    name: '',
    location: '',
    capacity: '',
    isActive: true,
    sortOrder: rooms.length + 1,
  });

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [roomsResponse, bookingsResponse] = await Promise.all([
        authFetch('/api/meeting-rooms'),
        authFetch(`/api/meeting-bookings?startDate=${startDate}&endDate=${endDate}`),
      ]);
      const roomsData = await roomsResponse.json();
      const bookingsData = await bookingsResponse.json();
      setRooms(roomsData.rooms || []);
      setBookings(bookingsData.bookings || []);
    } catch (error) {
      console.error('Failed to load meeting admin data', error);
      alert('無法讀取會議室後台資料');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [startDate, endDate]);

  const saveRoom = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    try {
      const roomId = roomForm.id || `ROOM-${Date.now()}`;
      const response = await authFetch('/api/meeting-rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...roomForm, id: roomId }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '儲存失敗');
      setRoomForm({ id: '', name: '', location: '', capacity: '', isActive: true, sortOrder: rooms.length + 1 });
      await loadData();
    } catch (error: any) {
      alert(error.message || '儲存失敗');
    } finally {
      setIsSaving(false);
    }
  };

  const editRoom = (room: MeetingRoom) => {
    setRoomForm(room);
  };

  const toggleRoom = async (room: MeetingRoom) => {
    const response = await authFetch('/api/meeting-rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...room, isActive: !room.isActive }),
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
      alert(data.error || '更新失敗');
      return;
    }
    setRooms((current) => current.map((item) => (
      item.id === room.id ? { ...item, isActive: !room.isActive } : item
    )));
  };

  const cancelBooking = async (bookingId: string) => {
    if (!confirm('確定要取消這筆預約嗎？')) return;
    const response = await authFetch(`/api/meeting-bookings/${bookingId}/cancel`, { method: 'POST' });
    const data = await response.json();
    if (!response.ok || !data.success) {
      alert(data.error || '取消失敗');
      return;
    }
    await loadData();
  };

  return (
    <div className="glass-panel rounded-2xl p-5 sm:p-8 md:p-10 w-full max-w-7xl animate-slide-up z-10">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-8">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold text-slate-900 flex items-center gap-3 mb-2">
            <Building2 className="text-indigo-500 w-8 h-8" />
            會議室管理
          </h2>
          <p className="text-slate-500">上架會議室、停用會議室，並管理預約紀錄。</p>
        </div>
        <button onClick={loadData} disabled={isLoading} className="bg-slate-900 hover:bg-slate-700 text-white px-5 py-3 rounded-xl font-semibold flex items-center justify-center gap-2 disabled:opacity-70">
          {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}
          重新整理
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6 mb-8">
        <form onSubmit={saveRoom} className="bg-white/80 border border-slate-200 rounded-2xl p-6 space-y-4">
          <h3 className="text-lg font-bold text-slate-900">{roomForm.id ? '編輯會議室' : '新增會議室'}</h3>
          <label className="block space-y-2">
            <span className="text-sm font-semibold text-slate-700">會議室名稱</span>
            <input value={roomForm.name} onChange={(event) => setRoomForm((previous) => ({ ...previous, name: event.target.value }))} required className="form-input !pl-4" placeholder="例如：5F會議室" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-700">位置</span>
              <input value={roomForm.location || ''} onChange={(event) => setRoomForm((previous) => ({ ...previous, location: event.target.value }))} className="form-input !pl-4" />
            </label>
            <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-700">容納人數</span>
              <input value={roomForm.capacity || ''} onChange={(event) => setRoomForm((previous) => ({ ...previous, capacity: event.target.value }))} className="form-input !pl-4" />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <input type="checkbox" checked={roomForm.isActive} onChange={(event) => setRoomForm((previous) => ({ ...previous, isActive: event.target.checked }))} />
            前台上架
          </label>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm text-slate-600">固定開放時間：09:00-18:00，中午可預約。</div>
          <button disabled={isSaving} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-3 rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-60">
            {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
            儲存會議室
          </button>
        </form>

        <div className="bg-white/80 border border-slate-200 rounded-2xl p-6">
          <h3 className="text-lg font-bold text-slate-900 mb-4">會議室清單</h3>
          <div className="space-y-3">
            {rooms.map((room) => (
              <div key={room.id} className="border border-slate-200 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                  <div className="font-bold text-slate-900">{room.name}</div>
                  <div className="text-sm text-slate-500">{room.location || '-'} / {room.capacity || '-'} 人 / {room.isActive ? '上架中' : '已停用'}</div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => editRoom(room)} className="px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold">編輯</button>
                  <button onClick={() => toggleRoom(room)} className={`px-3 py-2 rounded-lg text-sm font-semibold ${room.isActive ? 'bg-rose-50 hover:bg-rose-100 text-rose-600' : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-600'}`}>
                    {room.isActive ? '停用' : '上架'}
                  </button>
                </div>
              </div>
            ))}
            {!rooms.length && <p className="text-slate-500 text-sm">尚未建立會議室。</p>}
          </div>
        </div>
      </div>

      <div className="bg-white/80 border border-slate-200 rounded-2xl p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
          <h3 className="text-lg font-bold text-slate-900">預約管理</h3>
          <div className="flex gap-2">
            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="border border-slate-200 rounded-xl px-3 py-2" />
            <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="border border-slate-200 rounded-xl px-3 py-2" />
          </div>
        </div>
        <div className="space-y-3">
          {bookings.map((booking) => (
            <div key={booking.id} className="border border-slate-200 rounded-xl p-4 grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3">
              <div>
                <div className="font-bold text-slate-900">{booking.roomName} / {booking.date} {booking.startTime}-{booking.endTime}</div>
                <div className="text-sm text-slate-500 mt-1">預約人：{booking.bookerName} ({booking.bookerEmail}) / {booking.department}</div>
                <div className="text-sm text-slate-700 mt-2">用途：{booking.purpose}</div>
              </div>
              <button onClick={() => cancelBooking(booking.id)} className="self-start px-4 py-2 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 text-sm font-semibold inline-flex items-center gap-2">
                <Trash2 className="w-4 h-4" />
                取消預約
              </button>
            </div>
          ))}
          {!bookings.length && (
            <div className="text-center py-8 text-slate-500 border border-slate-200 border-dashed rounded-xl">
              <CheckCircle className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
              區間內沒有預約。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
