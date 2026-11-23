export function getClientId(): string {
  let id = sessionStorage.getItem('ct_client_id');
  if (!id) { id = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem('ct_client_id', id); }
  return id;
}
export const cleanName = (n: string) => n.replace(/[<>]/g, '').trim().slice(0, 20) || 'Mouse';
