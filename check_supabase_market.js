import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://sibisgiwmgdrpfkzmkkw.supabase.co';
const supabaseKey = 'sb_publishable_Y8Dk0GxPacMnHDDWmT3DcQ_fptqtC3h'; // anon key

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  console.log('Consultando tabla market_items en Supabase...');
  const { data, error } = await supabase
    .from('market_items')
    .select('*');

  if (error) {
    console.error('Error de consulta:', error.message);
    return;
  }

  console.log(`Consulta exitosa. Se encontraron ${data.length} items.`);
  if (data.length > 0) {
    console.log('Items encontrados:');
    data.forEach(item => {
      console.log(`- [${item.id}] ${item.name} (${item.price} oro) - stock_status: ${item.stock_status}`);
    });
  } else {
    console.log('La tabla market_items está VACÍA en Supabase.');
  }
}

check();
