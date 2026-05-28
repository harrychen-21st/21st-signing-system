import React, { useEffect, useMemo, useState } from 'react';
import { CalendarPlus, CheckCircle, Clock, DoorOpen, ExternalLink, Loader2, RefreshCw, Trash2, Users } from 'lucide-react';
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
};

type MeetingBooking = {
  id: string;
  roomId: string;
  roomName: string;
  bookerEmail: string;
  bookerName: string;
  department: string;
  date: string;
  startTime: string;
  endTime: string;
  purpose: string;
  status: string;
};

const timeSlots = Array.from({ length: 18 }, (_, index) => {
  const minutes = 9 * 60 + index * 30;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
});

function todayText() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addDaysText(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function timeToMinutes(time: string) {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

function addMinutes(time: string, minutesToAdd: number) {
  const minutes = timeToMinutes(time) + minutesToAdd;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function overlaps(booking: MeetingBooking, slot: string) {
  const slotStart = timeToMinutes(slot);
  const slotEnd = slotStart + 30;
  return timeToMinutes(booking.startTime) < slotEnd && timeToMinutes(booking.endTime) > slotStart;
}

function bookingOverlapsRange(booking: MeetingBooking, rangeStart: string, rangeEnd: string) {
  return timeToMinutes(booking.startTime) < timeToMinutes(rangeEnd) && timeToMinutes(booking.endTime) > timeToMinutes(rangeStart);
}

function googleCalendarUrl(booking: MeetingBooking) {
  const date = booking.date.replace(/-/g, '');
  const start = `${date}T${booking.startTime.replace(':', '')}00`;
  const end = `${date}T${booking.endTime.replace(':', '')}00`;
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${booking.roomName} 預約`,
    dates: `${start}/${end}`,
    details: `用途：${booking.purpose}\n預約單號：${booking.id}`,
    location: booking.roomName,
    ctz: 'Asia/Taipei',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export default function MeetingRoomBooking({ user }: { user: any }) {
  const [rooms, setRooms] = useState<MeetingRoom[]>([]);
  const [bookings, setBookings] = useState<MeetingBooking[]>([]);
  const [selectedDate, setSelectedDate] = useState(todayText());
  const [roomId, setRoomId] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [purpose, setPurpose] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const activeRooms = useMemo(() => rooms.filter((room) => room.isActive), [rooms]);
  const selectedRoom = activeRooms.find((room) => room.id === roomId);
  const endTime = addMinutes(startTime, durationMinutes);
  const myBookings = bookings.filter((booking) => booking.bookerEmail?.toLowerCase() === user.email?.toLowerCase());
  const selectedRangeOutOfHours = timeToMinutes(endTime) > 18 * 60;
  const selectedRangeBlocked = bookings.some(
    (booking) => booking.roomId === roomId && bookingOverlapsRange(booking, startTime, endTime)
  );
  const bookedSlotCount = activeRooms.reduce(
    (count, room) => count + timeSlots.filter((slot) => bookings.some((booking) => booking.roomId === room.id && overlaps(booking, slot))).length,
    0
  );
  const availableSlotCount = activeRooms.length * timeSlots.length - bookedSlotCount;

  const loadRooms = async () => {
    const response = await authFetch('/api/meeting-rooms');
    const data = await response.json();
    const nextRooms = data.rooms || [];
    setRooms(nextRooms);
    if (!roomId && nextRooms.length) {
      const firstActive = nextRooms.find((room: MeetingRoom) => room.isActive);
      if (firstActive) setRoomId(firstActive.id);
    }
  };

  const loadBookings = async () => {
    const response = await authFetch(`/api/meeting-bookings?startDate=${selectedDate}&endDate=${selectedDate}`);
    const data = await response.json();
    setBookings(data.bookings || []);
  };

  const loadData = async (includeRooms = false) => {
    setIsLoading(true);
    try {
      await (includeRooms || !rooms.length ? Promise.all([loadRooms(), loadBookings()]) : loadBookings());
    } catch (error) {
      console.error('Failed to load meeting data', error);
      alert('無法讀取會議室資料，請稍後再試。');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [selectedDate]);

  const createBooking = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!roomId || !purpose.trim()) return;
    if (selectedRangeOutOfHours) {
      alert('會議室開放時間到 18:00，請縮短使用時間或提早開始。');
      return;
    }
    if (selectedRangeBlocked) {
      alert('這個時段已經有人預約，請選擇其他時間。');
      return;
    }
    setIsSubmitting(true);
    try {
      const response = await authFetch('/api/meeting-bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, date: selectedDate, startTime, endTime, purpose }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '預約失敗');
      setPurpose('');
      if (data.booking) {
        setBookings((current) => [...current, data.booking]);
      } else {
        await loadBookings();
      }
      alert('會議室預約成功。');
    } catch (error: any) {
      alert(error.message || '預約失敗，請稍後再試。');
    } finally {
      setIsSubmitting(false);
    }
  };

  const cancelBooking = async (bookingId: string) => {
    if (!confirm('確定要取消這筆會議室預約嗎？')) return;
    try {
      const response = await authFetch(`/api/meeting-bookings/${bookingId}/cancel`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '取消失敗');
      setBookings((current) => current.filter((booking) => booking.id !== bookingId));
    } catch (error: any) {
      alert(error.message || '取消失敗，請稍後再試。');
    }
  };

  return (
    <div className="glass-panel rounded-2xl p-5 sm:p-8 md:p-10 w-full max-w-7xl animate-slide-up z-10">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold text-slate-900 flex items-center gap-3 mb-2">
            <CalendarPlus className="text-sky-500 w-8 h-8" />
            會議室預約
          </h2>
          <p className="text-slate-500">開放時間 09:00-18:00，中午可預約；一次 30 分鐘至 2 小時。</p>
        </div>
        <div className="flex gap-3">
          <input
            type="date"
            min={todayText()}
            max={addDaysText(30)}
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
            className="bg-white/80 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:border-sky-500"
          />
          <button
            onClick={() => loadData(true)}
            disabled={isLoading}
            className="bg-slate-900 hover:bg-slate-700 text-white px-5 py-3 rounded-xl font-semibold flex items-center gap-2 disabled:opacity-70"
          >
            {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}
            重新整理
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <div className="rounded-2xl border border-sky-100 bg-sky-50 px-5 py-4">
          <div className="text-xs font-bold text-sky-700 mb-1">開放時間</div>
          <div className="flex items-center gap-2 text-xl font-black text-slate-900"><Clock className="w-5 h-5 text-sky-500" />09:00-18:00</div>
        </div>
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-5 py-4">
          <div className="text-xs font-bold text-emerald-700 mb-1">可預約時段</div>
          <div className="flex items-center gap-2 text-xl font-black text-slate-900"><DoorOpen className="w-5 h-5 text-emerald-500" />{availableSlotCount} 格</div>
        </div>
        <div className="rounded-2xl border border-amber-100 bg-amber-50 px-5 py-4">
          <div className="text-xs font-bold text-amber-700 mb-1">已預約時段</div>
          <div className="flex items-center gap-2 text-xl font-black text-slate-900"><Users className="w-5 h-5 text-amber-500" />{bookedSlotCount} 格</div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white shadow-sm mb-8">
        <div className="min-w-[980px]">
          <div className="grid grid-cols-[170px_repeat(18,1fr)] bg-gradient-to-r from-slate-900 via-sky-800 to-emerald-700 text-[11px] font-bold text-white">
            <div className="p-3 border-r border-white/10">會議室</div>
            {timeSlots.map((slot) => (
              <div key={slot} className="p-2 text-center border-r border-white/10 last:border-r-0">{slot}</div>
            ))}
          </div>
          {activeRooms.map((room, roomIndex) => (
            <div key={room.id} className="grid grid-cols-[170px_repeat(18,1fr)] border-t border-slate-200">
              <div className={`p-4 border-r border-slate-200 font-bold text-slate-800 ${roomIndex % 2 ? 'bg-slate-50' : 'bg-white'}`}>
                {room.name}
                <div className="mt-1 flex items-center gap-2 text-xs font-medium text-slate-500">
                  <Users className="w-3.5 h-3.5" />
                  {room.capacity ? `${room.capacity} 人` : '未設定人數'}
                </div>
              </div>
              {timeSlots.map((slot) => {
                const booked = bookings.some((booking) => booking.roomId === room.id && overlaps(booking, slot));
                const selected = roomId === room.id && startTime === slot;
                return (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => {
                      setRoomId(room.id);
                      setStartTime(slot);
                    }}
                    className={`h-16 border-r border-slate-100 text-xs font-semibold transition-all ${
                      booked ? 'bg-gradient-to-br from-amber-100 to-rose-100 text-amber-800 cursor-not-allowed' : 'bg-white hover:bg-sky-50 text-sky-700'
                    } ${selected ? 'ring-2 ring-inset ring-sky-500 bg-sky-50' : ''}`}
                    disabled={booked}
                  >
                    {booked ? '已預約' : ''}
                  </button>
                );
              })}
            </div>
          ))}
          {!activeRooms.length && (
            <div className="p-8 text-center text-slate-500">目前尚無上架會議室，請由系統設定新增。</div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-6">
        <form onSubmit={createBooking} className="bg-white/80 border border-slate-200 rounded-2xl p-6 space-y-4">
          <h3 className="text-lg font-bold text-slate-900">建立預約</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="space-y-2">
              <span className="text-sm font-semibold text-slate-700">會議室</span>
              <select value={roomId} onChange={(event) => setRoomId(event.target.value)} required className="form-input !pl-4">
                <option value="">請選擇</option>
                {activeRooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-sm font-semibold text-slate-700">開始時間</span>
              <select value={startTime} onChange={(event) => setStartTime(event.target.value)} className="form-input !pl-4">
                {timeSlots.map((slot) => (
                  <option key={slot} value={slot}>
                    {slot}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-sm font-semibold text-slate-700">使用時間</span>
              <select value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value))} className="form-input !pl-4">
                <option value={30}>30 分鐘</option>
                <option value={60}>1 小時</option>
                <option value={90}>1.5 小時</option>
                <option value={120}>2 小時</option>
              </select>
            </label>
            <div className="space-y-2">
              <span className="text-sm font-semibold text-slate-700">預約時段</span>
              <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-semibold text-slate-700">
                {selectedRoom?.name || '未選擇'} / {startTime}-{endTime}
              </div>
            </div>
          </div>
          {selectedRangeOutOfHours && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
              會議室開放時間到 18:00，請縮短使用時間或提早開始。
            </div>
          )}
          {selectedRangeBlocked && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
              這個時段已有預約，請更換會議室或時間。
            </div>
          )}
          <label className="block space-y-2">
            <span className="text-sm font-semibold text-slate-700">用途</span>
            <textarea value={purpose} onChange={(event) => setPurpose(event.target.value)} rows={4} required className="form-input !pl-4" />
          </label>
          <button disabled={isSubmitting || !activeRooms.length || selectedRangeBlocked || selectedRangeOutOfHours} className="w-full bg-sky-600 hover:bg-sky-500 text-white px-5 py-3 rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-60">
            {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
            送出預約
          </button>
        </form>

        <div className="bg-white/80 border border-slate-200 rounded-2xl p-6">
          <h3 className="text-lg font-bold text-slate-900 mb-4">我在本日的預約</h3>
          <div className="space-y-3">
            {myBookings.map((booking) => (
              <div key={booking.id} className="border border-slate-200 rounded-xl p-4">
                <div className="font-bold text-slate-900">{booking.roomName}</div>
                <div className="text-sm text-slate-500 flex items-center gap-2 mt-1">
                  <Clock className="w-4 h-4" />
                  {booking.date} {booking.startTime}-{booking.endTime}
                </div>
                <div className="text-sm text-slate-700 mt-2">{booking.purpose}</div>
                <div className="flex flex-wrap gap-2 mt-4">
                  <a href={googleCalendarUrl(booking)} target="_blank" rel="noreferrer" className="px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold inline-flex items-center gap-2">
                    <ExternalLink className="w-4 h-4" />
                    加到 Google Calendar
                  </a>
                  <button onClick={() => cancelBooking(booking.id)} className="px-3 py-2 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 text-sm font-semibold inline-flex items-center gap-2">
                    <Trash2 className="w-4 h-4" />
                    取消
                  </button>
                </div>
              </div>
            ))}
            {!myBookings.length && <p className="text-slate-500 text-sm">本日尚無您的會議室預約。</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
