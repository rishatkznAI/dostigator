import { owner } from './fixtures'
const user = {id:owner,email:'demo@local.invalid',user_metadata:{display_name:'Демо'}}
export const useAuth = () => ({user,loading:false,signOut:async()=>undefined})
