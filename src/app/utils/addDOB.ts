// Utility to add dateOfBirth to mockMembers
// This patches the existing mockMembers with DOB data

export const memberDOBPatches: Record<string, string> = {
  '1': '1978-05-15',
  '2': '1980-08-22',
  '3': '2010-02-14',
  '4': '2012-11-30',
  '5': '1975-03-10',
  '6': '1977-07-18',
  '7': '2009-09-05',
  '8': '2011-12-20',
  '9': '1952-01-15',
  '10': '1982-06-25',
  '11': '1984-04-12',
  '12': '2008-10-08',
  '13': '1985-11-03',
  '14': '1987-01-28',
  '15': '2013-05-16',
  '16': '2015-08-09',
  '17': '1979-12-01',
  '18': '1981-03-14',
  '19': '2007-07-24',
  '20': '2014-04-19',
  '21': '1990-02-08',
  '22': '2010-06-12',
  '23': '2012-09-25',
  '24': '1976-10-20',
  '25': '1978-12-15',
  '26': '2006-05-30',
  '27': '2008-08-11',
  '28': '2011-03-22',
};

export function patchMemberWithDOB<T extends { id: string; dateOfBirth?: string }>(member: T): T {
  return {
    ...member,
    dateOfBirth: memberDOBPatches[member.id] || member.dateOfBirth,
  };
}
