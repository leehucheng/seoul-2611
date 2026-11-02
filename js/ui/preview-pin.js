// The pin shown while a place is being added: same look as a real pin (category colour and icon, a neutral pin
// when no category is chosen yet) with a pulsing ring, so it reads as "not saved yet". `L` is the Leaflet global.
import { categoryOf } from '../place-view.js';
import { h, icon } from './dom.js';

const BOX = 44; // touch box of every pin; the drawn circle is smaller

function previewIcon(categoryId) {
  const cat = categoryOf(categoryId);
  const pin = h('div', { class: 'pin pin--preview' }, icon(cat.icon));
  pin.style.setProperty('--c', cat.color);
  return L.divIcon({ className: 'pin-icon', html: pin, iconSize: [BOX, BOX], iconAnchor: [BOX / 2, BOX / 2] });
}

/** createPreviewPin(mapHandle) -> {show(lat, lng, categoryId), setCategory(id), hide(), position()} */
export function createPreviewPin(mapHandle) {
  let marker = null;
  let categoryId = '';

  return {
    show(lat, lng, category = categoryId) {
      categoryId = category;
      const map = mapHandle.getMap();
      if (marker) {
        marker.setLatLng([lat, lng]);
        marker.setIcon(previewIcon(categoryId));
      } else {
        marker = L.marker([lat, lng], { icon: previewIcon(categoryId), interactive: false, keyboard: false, zIndexOffset: 2500 }).addTo(map);
      }
    },
    setCategory(id) {
      categoryId = id;
      marker?.setIcon(previewIcon(categoryId));
    },
    hide() {
      marker?.remove();
      marker = null;
    },
    position() {
      if (!marker) return null;
      const { lat, lng } = marker.getLatLng();
      return { lat, lng };
    },
  };
}
