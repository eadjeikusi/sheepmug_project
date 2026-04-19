import { useMemo } from 'react';
import { sortedCountryOptions, type CountryCode } from '@/lib/phoneE164';

const DEFAULT_COUNTRY: CountryCode = 'US';

type Props = {
  id?: string;
  label: string;
  /** ISO 3166-1 alpha-2 */
  countryIso: string;
  onCountryChange: (iso: string) => void;
  /** National number (no country prefix) */
  national: string;
  onNationalChange: (v: string) => void;
  required?: boolean;
  disabled?: boolean;
  className?: string;
};

/**
 * Country selector + national phone input. Server normalizes to E.164 using country + raw.
 */
export default function PhoneCountryInput({
  id,
  label,
  countryIso,
  onCountryChange,
  national,
  onNationalChange,
  required,
  disabled,
  className = '',
}: Props) {
  const options = useMemo(() => sortedCountryOptions(), []);

  return (
    <div className={className}>
      <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
      <div className="flex flex-col sm:flex-row gap-2">
        <select
          id={id ? `${id}-country` : undefined}
          value={(countryIso || DEFAULT_COUNTRY).toUpperCase()}
          onChange={(e) => onCountryChange(e.target.value)}
          disabled={disabled}
          className="sm:w-44 shrink-0 px-3 py-3 bg-gray-50 border border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white text-sm"
          aria-label={`${label} country`}
        >
          {options.map(({ code, label: name }) => (
            <option key={code} value={code}>
              {code} — {name}
            </option>
          ))}
        </select>
        <input
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          value={national}
          onChange={(e) => onNationalChange(e.target.value)}
          disabled={disabled}
          required={required}
          placeholder="Phone number"
          className="flex-1 min-w-0 px-4 py-3 bg-gray-50 border border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
        />
      </div>
      <p className="mt-1 text-xs text-gray-500">Saved in international format (E.164) for SMS and consistency.</p>
    </div>
  );
}
