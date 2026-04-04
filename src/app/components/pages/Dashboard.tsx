import { Users, Church, UserCircle2, Trophy, TrendingUp, Calendar as CalendarIcon, Plus } from 'lucide-react';
import { mockMembers, mockEvents, getStats } from '../../utils/mockData';
import { motion } from 'motion/react';
import { Link } from 'react-router';

export default function Dashboard() {
  const stats = getStats();
  const recentMembers = mockMembers.slice(0, 3);
  const upcomingEvents = mockEvents.filter(e => new Date(e.date) >= new Date()).slice(0, 6);

  return (
    <div className="space-y-8">
      {/* Greeting */}
      <div>
        <h1 className="font-semibold text-gray-900 text-[24px]">Hello Admin</h1>
        <p className="mt-2 text-gray-500 text-[14px]">
          Do you already know what you will manage today? 🎯 
          <span className="ml-2">Let's get inspired 👍</span>
        </p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Total Members</p>
              <p className="font-semibold text-gray-900 mt-2 text-[24px]">{stats.totalMembers}</p>
              <div className="flex items-center mt-2">
                <TrendingUp className="w-4 h-4 text-green-500 mr-1" />
                <span className="text-sm text-green-600">+12%</span>
              </div>
            </div>
            <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center">
              <Users className="w-6 h-6 text-blue-600" />
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Churches</p>
              <p className="text-3xl font-semibold text-gray-900 mt-2">{stats.totalChurches}</p>
              <div className="flex items-center mt-2">
                <TrendingUp className="w-4 h-4 text-green-500 mr-1" />
                <span className="text-sm text-green-600">+5%</span>
              </div>
            </div>
            <div className="w-12 h-12 bg-purple-50 rounded-xl flex items-center justify-center">
              <Church className="w-6 h-6 text-purple-600" />
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Active Groups</p>
              <p className="text-3xl font-semibold text-gray-900 mt-2">{stats.totalGroups}</p>
              <div className="flex items-center mt-2">
                <TrendingUp className="w-4 h-4 text-green-500 mr-1" />
                <span className="text-sm text-green-600">+8%</span>
              </div>
            </div>
            <div className="w-12 h-12 bg-green-50 rounded-xl flex items-center justify-center">
              <UserCircle2 className="w-6 h-6 text-green-600" />
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Events This Month</p>
              <p className="text-3xl font-semibold text-gray-900 mt-2">{stats.upcomingEvents}</p>
              <div className="flex items-center mt-2">
                <TrendingUp className="w-4 h-4 text-green-500 mr-1" />
                <span className="text-sm text-green-600">+15%</span>
              </div>
            </div>
            <div className="w-12 h-12 bg-orange-50 rounded-xl flex items-center justify-center">
              <Trophy className="w-6 h-6 text-orange-600" />
            </div>
          </div>
        </motion.div>
      </div>

      {/* Add New Project Card + Events Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Add New Project Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl p-8 shadow-sm border border-blue-100 flex flex-col items-center justify-center text-center hover:shadow-md transition-shadow cursor-pointer"
        >
          <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mb-4 shadow-sm">
            <Plus className="w-8 h-8 text-indigo-600" />
          </div>
          <h3 className="font-semibold text-gray-900 mb-2 text-[15px]">Add new event</h3>
          <p className="text-gray-600 text-[13px]">
            Got nice event? Click to the to add a new event.
          </p>
        </motion.div>

        {/* Upcoming Events as Cards */}
        {upcomingEvents.slice(0, 5).map((event, index) => (
          <motion.div
            key={event.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 + index * 0.1 }}
            className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 hover:shadow-md transition-shadow"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 bg-yellow-50 rounded-xl flex items-center justify-center">
                {event.type === 'service' ? '⛪' : event.type === 'meeting' ? '👥' : '🎯'}
              </div>
              <button className="text-gray-400 hover:text-gray-600">
                <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                </svg>
              </button>
            </div>

            <h3 className="font-semibold text-gray-900 mb-2 text-[14px]">{event.title}</h3>
            <p className="text-gray-600 mb-4 line-clamp-2 text-[13px]">
              {event.location} - {event.time}
            </p>

            <div className="space-y-2">
              <div className="flex items-center text-gray-600">
                <CalendarIcon className="w-4 h-4 mr-2" />
                <span className="text-[15px] text-[14px]">Task: {event.type}</span>
              </div>
              <div className="flex items-center text-gray-600">
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="text-[15px] text-[14px]">Date: {new Date(event.date).toLocaleDateString()}</span>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between">
              <div className="flex -space-x-2">
                {[1, 2, 3].map((i) => (
                  <img
                    key={i}
                    src={`https://images.unsplash.com/photo-${1500000000000 + i * 100000000}?w=100&h=100&fit=crop`}
                    alt=""
                    className="w-8 h-8 rounded-full border-2 border-white object-cover"
                  />
                ))}
                <div className="w-8 h-8 rounded-full bg-gray-200 border-2 border-white flex items-center justify-center text-xs font-medium text-gray-600">
                  +{event.attendanceCount - 3}
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Recent Members Section */}
      <div>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-gray-900">Recent Members</h2>
          <Link to="/members" className="text-sm text-indigo-600 hover:text-indigo-700 font-medium">
            View all →
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {recentMembers.map((member, index) => (
            <motion.div
              key={member.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.8 + index * 0.1 }}
              className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 hover:shadow-md transition-shadow"
            >
              <div className="flex items-center space-x-4">
                <img
                  src={member.member_url || ''}
                  alt={`${member.first_name} ${member.last_name}`}
                  className="w-16 h-16 rounded-xl object-cover"
                  referrerPolicy="no-referrer"
                />
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900 text-[15px]">{member.first_name} {member.last_name}</h3>
                  <p className="text-gray-500 text-[13px]">{member.address}</p>
                  <div className="mt-2 flex items-center">
                    <div className="flex items-center">
                      <span className="font-medium text-green-600 text-[13px]">{member.status}</span>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}