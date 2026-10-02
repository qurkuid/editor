require 'json'
root='/Users/changseok/editor/outputs/onheuk-straight-10'
export=JSON.parse(File.read(File.join(root,'export-verification.json')))
results=[]
export['products'].each do |p|
  path=File.join(root,p['file'])
  raise "Open failed #{path}" unless Sketchup.open_file(path)
  m=Sketchup.active_model
  gs=m.entities.grep(Sketchup::Group)
  raise 'Individual panels invalid' unless gs.length==p['part_count'] && gs.all?{|g|g.manifold? && g.volume>0 && g.entities.grep(Sketchup::Edge).none?{|e|e.curve}}
  b=m.bounds;center=b.center;distance=[b.width,b.height,b.depth,1000.mm].max*2
  m.active_view.camera=Sketchup::Camera.new(center+Geom::Vector3d.new(distance,-distance,distance*0.8),center,[0,0,1],false)
  m.active_view.camera.height=[b.width,b.height,b.depth,450.mm].max*1.6
  m.options['UnitsOptions']['LengthUnit']=2
  m.options['UnitsOptions']['LengthFormat']=0
  m.options['UnitsOptions']['LengthPrecision']=0
  m.rendering_options['DisplaySketchAxes']=false
  m.rendering_options['DrawSilhouettes']=false
  m.rendering_options['DrawLineEnds']=false
  m.rendering_options['DrawGround']=false
  m.rendering_options['DrawHorizon']=false
  m.rendering_options['BackgroundColor']=Sketchup::Color.new(250,250,247)
  m.entities.add_text("#{p['name']}\n#{p['target_size_mm'].map(&:to_i).join(' × ')} mm\n내부 치수·결합부 추정",b.min+Geom::Vector3d.new(0,-200.mm,0))
  m.active_view.refresh
  raise 'Save failed' unless m.save
  results<<{file:path,solid_count:gs.length,straight_only:true}
end
File.write(File.join(root,'individual-runtime-verification.json'),JSON.pretty_generate(results))
raise 'Gallery reopen failed' unless Sketchup.open_file(File.join(root,'onheuk-straight-10-gallery.skp'))
puts "INDIVIDUAL COMPLETE: #{results.length} files saved and verified; gallery reopened"
