import { ShiftWithDetails } from '../../lib/bookings'
import CompactWorkingShiftCard from './CompactWorkingShiftCard'
import styles from './WorkingShiftsSlider.module.css'

interface WorkingShiftsSliderProps {
  shifts: ShiftWithDetails[]
  onShiftClick: (shift: ShiftWithDetails) => void
}

export default function WorkingShiftsSlider({
  shifts,
  onShiftClick
}: WorkingShiftsSliderProps) {
  return (
    <div className={styles.slider}>
      {shifts.map(shift => (
        <CompactWorkingShiftCard
          key={shift.id}
          restaurantName={shift.job.restaurant.name}
          shiftDate={shift.job.shift_date}
          onClick={() => onShiftClick(shift)}
        />
      ))}
    </div>
  )
}
