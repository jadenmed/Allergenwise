import { useParams } from "react-router-dom";
import checkFatGreen from "../assets/check-fat-green.svg";
import mapPin from "../assets/map-pin.svg";
import Badge from "./ui/Badge";

const CERTIFICATE = {
  name: "The Garden Table",
  address: "412 Mill St · Portland, OR",
  renewedOn: "Renewed Mar 4, 2026",
  credentialId: "AW-PDX-8FQ2-K9",
  staffCertified: "9 of 9",
  issued: "Mar 4, 2026",
  validThrough: "Mar 4, 2027",
  staff: [
    { name: "Maria Reyes", role: "General Manager" },
    { name: "Daniel Kim", role: "Head Chef" },
    { name: "Amara Okafor", role: "Server" },
  ],
};

const STAFF_CREDENTIALS = {
  "AW-MR-3F2K": {
    name: "Maria Reyes",
    role: "General Manager",
    individualIssued: "Mar 4, 2026",
    issued: "Mar 4, 2026",
    validThrough: "Mar 4, 2027",
  },
  "AW-DK-7H4M": {
    name: "Daniel Kim",
    role: "Head Chef",
    individualIssued: "Jun 22, 2025",
    issued: "Mar 4, 2026",
    validThrough: "Mar 4, 2027",
  },
  "AW-AD-9P1Q": {
    name: "Amara Okafor",
    role: "Server",
    individualIssued: "Mar 4, 2026",
    issued: "Mar 4, 2026",
    validThrough: "Mar 4, 2027",
  },
  "AW-LS-2W5N": {
    name: "Luis Soto",
    role: "Line Cook",
    individualIssued: "Mar 4, 2026",
    issued: "Mar 4, 2026",
    validThrough: "Mar 4, 2027",
  },
  "AW-HT-6V8B": {
    name: "Hannah Tran",
    role: "Server",
    individualIssued: "Mar 4, 2026",
    issued: "Mar 4, 2026",
    validThrough: "Mar 4, 2027",
  },
};

function getInitials(name) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("");
}

function IndividualCredentialCard({ staffMember, badgeQr }) {
  const { name, role, individualIssued, issued, validThrough } = staffMember;

  return (
    <div className="w-full rounded-2xl border border-grey-300 bg-white overflow-hidden text-left">
      <div className="flex flex-col gap-4 items-start bg-teal-050 p-6 sm:p-8">
        <div className="flex items-center justify-center size-16 rounded-full bg-green-100">
          <img src={checkFatGreen} alt="" className="size-8" />
        </div>
        <div className="flex flex-col gap-1 items-start w-full">
          <p className="text-xs font-bold uppercase tracking-wide text-green-700">
            Individual credential verified
          </p>
          <h2 className="font-serif font-semibold text-2xl text-teal-950">
            {name}
          </h2>
          <p className="text-base text-grey-600">
            {role} &middot; {CERTIFICATE.name} &middot;{" "}
            {CERTIFICATE.address.split("\u00b7")[1]?.trim()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="green">Active</Badge>
          <p className="text-base text-grey-600">Issued {individualIssued}</p>
        </div>
      </div>

      <div className="flex flex-col gap-6 items-start p-6 sm:p-8">
        <div className="grid grid-cols-2 gap-x-6 gap-y-6 w-full">
          <div className="flex flex-col gap-1 items-start">
            <p className="text-xs font-semibold uppercase tracking-wide text-grey-500">
              Credential ID
            </p>
            <p className="text-lg font-semibold text-teal-950">
              {CERTIFICATE.credentialId}
            </p>
          </div>
          <div className="flex flex-col gap-1 items-start">
            <p className="text-xs font-semibold uppercase tracking-wide text-grey-500">
              Badge QR
            </p>
            <p className="text-lg font-semibold text-teal-950">{badgeQr}</p>
          </div>
          <div className="flex flex-col gap-1 items-start">
            <p className="text-xs font-semibold uppercase tracking-wide text-grey-500">
              Issued
            </p>
            <p className="text-lg font-semibold text-teal-950">{issued}</p>
          </div>
          <div className="flex flex-col gap-1 items-start">
            <p className="text-xs font-semibold uppercase tracking-wide text-grey-500">
              Valid through
            </p>
            <p className="text-lg font-semibold text-teal-950">
              {validThrough}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full rounded-lg bg-green-100 px-4 py-3">
          <img src={checkFatGreen} alt="" className="size-4" />
          <p className="text-sm font-semibold text-green-700">
            Verified just now · live from the registry
          </p>
        </div>

        <p className="text-sm text-grey-600">
          Credential is tied to the individual and portable between
          certified restaurants.
        </p>

        <a
          href="#"
          className="inline-flex items-center gap-2 rounded-md border border-grey-400 bg-white px-4 py-2.5 text-base font-semibold text-teal-700 hover:bg-grey-100"
        >
          Report a concern &rarr;
        </a>
      </div>
    </div>
  );
}

export default function CertificateVerification() {
  const { credentialId: paramId } = useParams();
  const staffMember = paramId
    ? STAFF_CREDENTIALS[paramId.toUpperCase()]
    : undefined;

  const {
    name,
    address,
    renewedOn,
    credentialId,
    staffCertified,
    issued,
    validThrough,
    staff,
  } = CERTIFICATE;

  return (
    <section className="w-full flex flex-col items-center bg-grey-100 px-4 sm:px-6 lg:px-12 pt-10 sm:pt-14 lg:pt-16 pb-16 lg:pb-24">
      <div className="w-full max-w-[600px] flex flex-col gap-6 items-center text-center anim-fade-up">
        <Badge>Public verification</Badge>
        <h1 className="font-serif font-semibold text-3xl sm:text-4xl leading-tight sm:leading-[48px] text-teal-950">
          This Certification is Real and Current.
        </h1>

        {staffMember && (
          <IndividualCredentialCard
            staffMember={staffMember}
            badgeQr={paramId.toUpperCase()}
          />
        )}

        {!staffMember && (
          <div className="w-full rounded-2xl border border-grey-300 bg-white overflow-hidden text-left">
            <div className="flex flex-col gap-4 items-start bg-teal-050 p-6 sm:p-8">
              <div className="flex items-center justify-center size-16 rounded-full bg-green-100">
                <img src={checkFatGreen} alt="" className="size-8" />
              </div>
              <div className="flex flex-col gap-1 items-start w-full">
                <p className="text-xs font-bold uppercase tracking-wide text-green-700">
                  Certification verified
                </p>
                <h2 className="font-serif font-semibold text-2xl text-teal-950">
                  {name}
                </h2>
                <p className="text-base text-grey-600">{address}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone="green">Active</Badge>
                <p className="text-base text-grey-600">{renewedOn}</p>
              </div>
            </div>

            <div className="flex flex-col gap-6 items-start p-6 sm:p-8">
              <div className="grid grid-cols-2 gap-x-6 gap-y-6 w-full">
                <div className="flex flex-col gap-1 items-start">
                  <p className="text-xs font-semibold uppercase tracking-wide text-grey-500">
                    Credential ID
                  </p>
                  <p className="text-lg font-semibold text-teal-950">
                    {credentialId}
                  </p>
                </div>
                <div className="flex flex-col gap-1 items-start">
                  <p className="text-xs font-semibold uppercase tracking-wide text-grey-500">
                    Staff certified
                  </p>
                  <p className="text-lg font-semibold text-teal-950">
                    {staffCertified}
                  </p>
                </div>
                <div className="flex flex-col gap-1 items-start">
                  <p className="text-xs font-semibold uppercase tracking-wide text-grey-500">
                    Issued
                  </p>
                  <p className="text-lg font-semibold text-teal-950">{issued}</p>
                </div>
                <div className="flex flex-col gap-1 items-start">
                  <p className="text-xs font-semibold uppercase tracking-wide text-grey-500">
                    Valid through
                  </p>
                  <p className="text-lg font-semibold text-teal-950">
                    {validThrough}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 w-full rounded-lg bg-green-100 px-4 py-3">
                <img src={checkFatGreen} alt="" className="size-4" />
                <p className="text-sm font-semibold text-green-700">
                  Verified just now · live from the registry
                </p>
              </div>

              <div className="flex flex-col gap-3 items-start w-full">
                <p className="text-xs font-bold uppercase tracking-wide text-grey-800">
                  Certified staff on record
                </p>
                <div className="flex flex-col divide-y divide-grey-300 w-full">
                  {staff.map(({ name: staffName, role }) => (
                    <div
                      key={staffName}
                      className="flex items-center justify-between gap-4 py-3 w-full"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center size-8 rounded-full bg-teal-100 text-xs font-bold text-teal-700 shrink-0">
                          {getInitials(staffName)}
                        </div>
                        <p className="text-base text-teal-950">{staffName}</p>
                      </div>
                      <p className="text-base text-grey-600">{role}</p>
                    </div>
                  ))}
                </div>
              </div>

              <a
                href="#"
                className="inline-flex items-center gap-2 rounded-md border border-grey-400 bg-white px-4 py-2.5 text-base font-semibold text-teal-700 hover:bg-grey-100"
              >
                <img src={mapPin} alt="" className="size-5" />
                Find on map
              </a>

              <p className="text-xs text-grey-500">
                Certification records are maintained by AllergenWise and
                verified in real time.
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
