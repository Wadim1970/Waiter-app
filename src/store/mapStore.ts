import { create } from 'zustand'

interface MapState {
  // Координаты центра карты
  center: [number, number]
  // Уровень зума
  zoom: number
  // Выбранная дата
  selectedDate: Date
  
  // Функции обновления состояния
  setCenter: (center: [number, number]) => void
  setZoom: (zoom: number) => void
  setSelectedDate: (date: Date) => void
}

export const useMapStore = create<MapState>((set) => ({
  // НОВОЕ: Дефолтные значения для Москвы
  center: [55.7558, 37.6173],
  zoom: 13,
  selectedDate: new Date(),
  
  // НОВОЕ: Сеттеры для обновления состояния
  setCenter: (center) => set({ center }),
  setZoom: (zoom) => set({ zoom }),
  setSelectedDate: (selectedDate) => set({ selectedDate })
}))
