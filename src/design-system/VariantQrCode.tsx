import QRCode from 'react-native-qrcode-svg';

import { color } from './tokens';

/** Renders a scannable karekod for one variant's barcode value — generated
 * live from the string, nothing stored on disk for it (unlike the variant
 * photo). Used both in the Ürünler screen's "karekod" dialog and, later,
 * wherever manual-order entry wants a scan target. */
export function VariantQrCode({ value, size = 220 }: { value: string; size?: number }) {
  return <QRCode value={value} size={size} color={color.text} backgroundColor={color.bg} />;
}
