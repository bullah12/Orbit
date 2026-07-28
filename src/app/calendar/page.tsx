import { redirect } from 'next/navigation';

/** The calendar opens on the week. Day and month are one click away. */
export default function CalendarIndex() {
  redirect('/calendar/week');
}
