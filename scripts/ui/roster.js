import { MAX_ATTENDEES } from '../data/config.js';
import { state, saveAttendees } from '../state/storage.js';

// Ensures attendees do not exceed the limit and updates the inline notice text/visibility.
export function clampPlayLimit(){
  const over = state.attendees.length > MAX_ATTENDEES;
  if(over){
    state.attendees = state.attendees.slice(0, MAX_ATTENDEES);
    saveAttendees();
  }
  const notice = typeof document !== 'undefined' ? document.getElementById('limitNotice') : null;
  if(notice){
    notice.textContent = `Limit reached: maximum ${MAX_ATTENDEES} players.`;
    if(state.attendees.length >= MAX_ATTENDEES){
      notice.style.display = '';
    } else {
      notice.style.display = 'none';
    }
  }
}
